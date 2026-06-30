import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { EmbeddingClient } from './types.js';

const THROTTLE_RETRIES    = 3;
const THROTTLE_BASE_DELAY = 1_000; // ms, doubles each attempt

function isThrottlingError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'ThrottlingException' || code === 429;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `tasks` with at most `concurrency` in flight at a time.
 * Preserves input order in the returned array.
 */
async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

export class BedrockTitanClient implements EmbeddingClient {
  readonly dimensions: number;
  private client: BedrockRuntimeClient;
  private modelId: string;
  private concurrency: number;

  constructor(
    region: string,
    dimensions: number,
    modelId: string,
    concurrency: number,
    credentials?: { accessKeyId: string; secretAccessKey: string },
  ) {
    this.dimensions  = dimensions;
    this.modelId     = modelId;
    this.concurrency = concurrency;
    this.client = new BedrockRuntimeClient({
      region,
      ...(credentials !== undefined && { credentials }),
    });
  }

  async embed(text: string): Promise<number[]> {
    return this.embedWithRetry(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const tasks = texts.map((t) => () => this.embedWithRetry(t));
    return withConcurrency(tasks, this.concurrency);
  }

  private async embedWithRetry(text: string): Promise<number[]> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= THROTTLE_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = THROTTLE_BASE_DELAY * Math.pow(2, attempt - 1);
        console.warn(
          `[embedding] ThrottlingException — retrying in ${delay}ms (attempt ${attempt}/${THROTTLE_RETRIES})`,
        );
        await sleep(delay);
      }
      try {
        return await this.invoke(text);
      } catch (err) {
        if (isThrottlingError(err) && attempt < THROTTLE_RETRIES) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  private async invoke(text: string): Promise<number[]> {
    const body = JSON.stringify({
      inputText: text,
      dimensions: this.dimensions,
      normalize: true,
    });

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(body),
    });

    const response = await this.client.send(command);
    const parsed = JSON.parse(Buffer.from(response.body).toString('utf-8')) as {
      embedding: number[];
      inputTextTokenCount: number;
    };

    return parsed.embedding;
  }
}
