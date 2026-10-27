/** Thrown when a required external service has not been connected yet. */
export class NotConnectedError extends Error {
  constructor(service, hint) {
    super(`${service} is not connected. ${hint || ""}`.trim());
    this.name = "NotConnectedError";
    this.service = service;
    this.status = 501;
  }
}
