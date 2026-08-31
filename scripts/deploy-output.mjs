export function redactSensitiveOutput(output, sensitiveValues = []) {
  let redacted = output ?? "";
  for (const value of sensitiveValues) {
    if (value) redacted = redacted.replaceAll(value, "[REDACTED]");
  }
  return redacted.replace(/vcp_[A-Za-z0-9._-]+/g, "[REDACTED]");
}
