export class NpciError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends NpciError {}

export class NotFoundError extends NpciError {}

export class RateLimitedError extends NpciError {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
  }
}

export class UpstreamError extends NpciError {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export class StructureChangedError extends NpciError {}
