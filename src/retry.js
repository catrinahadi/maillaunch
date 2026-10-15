export function httpStatus(error) {
  const status = error?.status ?? error?.response?.status ?? error?.code;
  const numericStatus = Number(status);
  return Number.isInteger(numericStatus) ? numericStatus : undefined;
}

export async function retryAfterAuth(operation, refreshToken, onRetry = () => {}) {
  try {
    return await operation();
  } catch (error) {
    if (httpStatus(error) !== 401) throw error;
    try {
      await refreshToken();
    } catch (refreshError) {
      const error = new Error(`Authentication failed; re-authenticate and resume. Token refresh failed: ${refreshError.message}`, { cause: refreshError });
      error.status = 401;
      throw error;
    }
    await onRetry(error);
    return operation();
  }
}

export async function retryWithBackoff(operation, { attempts = 3, baseSeconds = 2, sleepFn = ms => new Promise(resolve => setTimeout(resolve, ms)), retryable = e => !(e.status === 401 || e.status === 403) && (e.status === 429 || !e.status || e.status >= 500), onRetry = () => {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await operation(attempt); } // run the operation once per retry loop
    catch (error) {
      lastError = error;
      if (attempt >= attempts || !retryable(error)) throw error; // stop on auth failures or exhausted retries
      const delaySeconds = Math.min(300, baseSeconds * (2 ** (attempt - 1))); // exponential backoff keeps retries controlled
      await onRetry({ error, attempt, nextAttempt: attempt + 1, delaySeconds });
      await sleepFn(delaySeconds * 1000); // pause before trying again
    }
  }
  throw lastError;
}
