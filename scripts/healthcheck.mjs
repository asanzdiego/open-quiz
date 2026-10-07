try {
  const port = process.env.PORT ?? '3000';
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  if (response.status !== 200 || (await response.json()).status !== 'ok') {
    process.exitCode = 1;
  }
} catch {
  process.exitCode = 1;
}
