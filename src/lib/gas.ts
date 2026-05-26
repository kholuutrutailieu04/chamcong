type GasUploadPayload = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  folderHint?: string | null;
  sourceRecordId: string;
  supabasePath: string;
};

type GasUploadResult = {
  driveLink: string;
  driveFileId?: string | null;
};

type GasReportEmailPayload = {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

type GasReportEmailResult = {
  message: string;
  provider?: string;
};

function getGasConfig() {
  const endpoint = process.env.GAS_UPLOAD_WEBAPP_URL;
  const sharedSecret = process.env.GAS_UPLOAD_SHARED_SECRET;

  if (!endpoint) {
    throw new Error('GAS_UPLOAD_WEBAPP_URL is not configured');
  }
  if (!sharedSecret) {
    throw new Error('GAS_UPLOAD_SHARED_SECRET is not configured');
  }

  return { endpoint, sharedSecret };
}

export async function uploadBufferToGas(payload: GasUploadPayload): Promise<GasUploadResult> {
  const { endpoint, sharedSecret } = getGasConfig();
  const requestBody = {
    action: 'upload',
    secret: sharedSecret,
    fileName: payload.fileName,
    mimeType: payload.mimeType || 'image/jpeg',
    folderHint: payload.folderHint || '',
    sourceRecordId: payload.sourceRecordId,
    supabasePath: payload.supabasePath,
    imageBase64: payload.buffer.toString('base64'),
  };

  let response: Response | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), 20000);

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });
      clearTimeout(timer);
      break;
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error('Unknown GAS request error');
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        continue;
      }
      throw lastError;
    }
  }

  if (!response) {
    throw lastError || new Error('GAS request failed without response');
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`GAS upload failed (${response.status}): ${errText || 'unknown error'}`);
  }

  const data = (await response.json()) as {
    success?: boolean;
    driveLink?: string;
    driveFileId?: string;
    error?: string;
  };

  if (!data?.success || !data.driveLink) {
    throw new Error(data?.error || 'GAS upload response is invalid');
  }

  return {
    driveLink: data.driveLink,
    driveFileId: data.driveFileId ?? null,
  };
}

export async function sendReportEmailViaGas(payload: GasReportEmailPayload): Promise<GasReportEmailResult> {
  const { endpoint, sharedSecret } = getGasConfig();
  const requestBody = {
    action: 'sendReportEmail',
    secret: sharedSecret,
    to: payload.to,
    cc: payload.cc ?? [],
    bcc: payload.bcc ?? [],
    subject: payload.subject,
    body: payload.body,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    fileBase64: payload.buffer.toString('base64'),
  };

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), 30000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`GAS report email failed (${response.status}): ${errText || 'unknown error'}`);
    }

    const data = (await response.json()) as {
      success?: boolean;
      message?: string;
      provider?: string;
      error?: string;
      primary_error?: string;
      fallback_error?: string;
    };

    if (!data?.success) {
      const details = [data?.primary_error, data?.fallback_error].filter(Boolean).join(' | ');
      throw new Error(`${data?.error || 'GAS report email response is invalid'}${details ? `: ${details}` : ''}`);
    }

    return { message: data.message || 'sent', provider: data.provider };
  } finally {
    clearTimeout(timer);
  }
}
