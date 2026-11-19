import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix("api/v1");
  const trustProxyHops = process.env.TRUST_PROXY_HOPS;
  if (trustProxyHops !== undefined) {
    const parsedHops = Number(trustProxyHops);
    if (!Number.isInteger(parsedHops) || parsedHops < 1) {
      throw new Error("TRUST_PROXY_HOPS must be a positive integer when configured.");
    }
    // Configure only the known number of trusted reverse-proxy hops.
    app.getHttpAdapter().getInstance().set("trust proxy", parsedHops);
  }
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? ["http://localhost:3000"],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
}
void bootstrap();
