const { publicErrorMessage } = require('./http-errors.cjs');

function businessError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function errorPayload(error) {
  return {
    message: publicErrorMessage(error),
    ...(error?.code ? { code: error.code } : {}),
    ...(error?.details !== undefined ? { details: error.details } : {}),
  };
}

module.exports = { businessError, errorPayload };
