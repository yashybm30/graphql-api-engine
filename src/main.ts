import { createApp } from "./server";
async function main() {
  const server = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  await new Promise<void>((resolve) =>
    server.http.listen(port, "0.0.0.0", resolve),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      void server.close().catch(console.error);
    });
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
