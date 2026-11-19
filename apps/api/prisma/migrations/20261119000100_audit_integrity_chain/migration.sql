CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "AuditLog"
  ADD COLUMN "chainSequence" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "previousHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "recordHash" TEXT NOT NULL DEFAULT '';

CREATE TABLE "AuditChainHead" (
  "organizationId" TEXT NOT NULL,
  "lastSequence" BIGINT NOT NULL DEFAULT 0,
  "lastHash" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditChainHead_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "AuditChainHead_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE FUNCTION sentinel_audit_log_hash(
  p_id TEXT,
  p_organization_id TEXT,
  p_actor_id TEXT,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_metadata JSONB,
  p_created_at TIMESTAMP(3),
  p_sequence BIGINT,
  p_previous_hash TEXT
) RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      convert_to(
        jsonb_build_array(
          p_id, p_organization_id, p_actor_id, p_action, p_entity_type,
          p_entity_id, p_metadata, p_created_at, p_sequence, p_previous_hash
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- Backfill existing audit events in a deterministic per-workspace order.
DO $$
DECLARE
  org RECORD;
  event RECORD;
  v_sequence BIGINT;
  v_previous_hash TEXT;
  v_hash TEXT;
BEGIN
  FOR org IN SELECT DISTINCT "organizationId" FROM "AuditLog" LOOP
    v_sequence := 0;
    v_previous_hash := '';

    FOR event IN
      SELECT * FROM "AuditLog"
      WHERE "organizationId" = org."organizationId"
      ORDER BY "createdAt" ASC, "id" ASC
    LOOP
      v_sequence := v_sequence + 1;
      v_hash := sentinel_audit_log_hash(
        event."id", event."organizationId", event."actorId",
        event."action", event."entityType", event."entityId",
        event."metadata", event."createdAt", v_sequence, v_previous_hash
      );

      UPDATE "AuditLog"
      SET "chainSequence" = v_sequence,
          "previousHash" = v_previous_hash,
          "recordHash" = v_hash
      WHERE "id" = event."id";

      v_previous_hash := v_hash;
    END LOOP;

    INSERT INTO "AuditChainHead" ("organizationId", "lastSequence", "lastHash", "updatedAt")
    VALUES (org."organizationId", v_sequence, v_previous_hash, CURRENT_TIMESTAMP);
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX "AuditLog_organizationId_chainSequence_key"
  ON "AuditLog"("organizationId", "chainSequence");

CREATE FUNCTION sentinel_audit_log_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_sequence BIGINT;
  v_previous_hash TEXT;
BEGIN
  INSERT INTO "AuditChainHead" ("organizationId", "lastSequence", "lastHash", "updatedAt")
  VALUES (NEW."organizationId", 0, '', CURRENT_TIMESTAMP)
  ON CONFLICT ("organizationId") DO NOTHING;

  SELECT "lastSequence", "lastHash"
  INTO v_sequence, v_previous_hash
  FROM "AuditChainHead"
  WHERE "organizationId" = NEW."organizationId"
  FOR UPDATE;

  NEW."chainSequence" := v_sequence + 1;
  NEW."previousHash" := v_previous_hash;
  NEW."recordHash" := sentinel_audit_log_hash(
    NEW."id", NEW."organizationId", NEW."actorId",
    NEW."action", NEW."entityType", NEW."entityId",
    NEW."metadata", NEW."createdAt", NEW."chainSequence", NEW."previousHash"
  );

  UPDATE "AuditChainHead"
  SET "lastSequence" = NEW."chainSequence",
      "lastHash" = NEW."recordHash",
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "organizationId" = NEW."organizationId";

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AuditLog_chain_before_insert"
BEFORE INSERT ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION sentinel_audit_log_before_insert();

CREATE FUNCTION sentinel_reject_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records are append-only and cannot be changed or deleted.'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "AuditLog_reject_update"
BEFORE UPDATE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION sentinel_reject_audit_log_mutation();

CREATE TRIGGER "AuditLog_reject_delete"
BEFORE DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION sentinel_reject_audit_log_mutation();

-- Preserve the immutable actor and workspace references instead of nulling/deleting them.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_organizationId_fkey";
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorId_fkey";
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sentinel_verify_audit_chain(p_organization_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  event RECORD;
  v_expected_sequence BIGINT := 1;
  v_previous_hash TEXT := '';
  v_hash TEXT;
  v_head_sequence BIGINT;
  v_head_hash TEXT;
  v_count BIGINT := 0;
BEGIN
  FOR event IN
    SELECT * FROM "AuditLog"
    WHERE "organizationId" = p_organization_id
    ORDER BY "chainSequence" ASC
  LOOP
    v_count := v_count + 1;
    v_hash := sentinel_audit_log_hash(
      event."id", event."organizationId", event."actorId",
      event."action", event."entityType", event."entityId",
      event."metadata", event."createdAt", event."chainSequence",
      event."previousHash"
    );

    IF event."chainSequence" <> v_expected_sequence
       OR event."previousHash" <> v_previous_hash
       OR event."recordHash" <> v_hash THEN
      RETURN jsonb_build_object(
        'verified', false,
        'recordsChecked', v_count,
        'brokenAtSequence', event."chainSequence",
        'reason', 'CHAIN_LINK_OR_RECORD_HASH_MISMATCH'
      );
    END IF;

    v_expected_sequence := v_expected_sequence + 1;
    v_previous_hash := v_hash;
  END LOOP;

  SELECT "lastSequence", "lastHash"
  INTO v_head_sequence, v_head_hash
  FROM "AuditChainHead"
  WHERE "organizationId" = p_organization_id;

  IF v_count = 0 THEN
    RETURN jsonb_build_object(
      'verified', v_head_sequence IS NULL OR v_head_sequence = 0,
      'recordsChecked', 0,
      'reason', CASE WHEN v_head_sequence IS NULL OR v_head_sequence = 0
        THEN 'EMPTY_CHAIN' ELSE 'CHAIN_HEAD_MISMATCH' END
    );
  END IF;

  IF v_head_sequence <> v_count OR v_head_hash <> v_previous_hash THEN
    RETURN jsonb_build_object(
      'verified', false,
      'recordsChecked', v_count,
      'reason', 'CHAIN_HEAD_MISMATCH'
    );
  END IF;

  RETURN jsonb_build_object(
    'verified', true,
    'recordsChecked', v_count,
    'lastSequence', v_head_sequence,
    'lastHash', v_head_hash,
    'algorithm', 'SHA-256'
  );
END;
$$;
