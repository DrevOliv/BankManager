/** An error whose message is safe and useful to show to the user (returned as HTTP 400). */
export class UserError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = 'UserError';
  }
}
