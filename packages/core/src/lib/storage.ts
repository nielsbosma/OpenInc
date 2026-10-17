import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getEnv } from '../env.ts';

let client: S3Client | undefined;

function s3(): { client: S3Client; bucket: string } {
  const env = getEnv();
  client ??= new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    // Path-style works on MinIO, R2 and most S3-compatible stores; AWS uses virtual-host style.
    forcePathStyle: !!env.S3_ENDPOINT,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  return { client, bucket: env.S3_BUCKET };
}

export async function putObject(key: string, body: Buffer | string, contentType: string): Promise<void> {
  const { client, bucket } = s3();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function uploadStream(key: string, body: Readable, contentType: string): Promise<void> {
  const { client, bucket } = s3();
  await new Upload({ client, params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType } }).done();
}

export async function getObjectStream(key: string): Promise<Readable> {
  const { client, bucket } = s3();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return res.Body as Readable;
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const { client, bucket } = s3();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

export async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = s3();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function listObjects(prefix: string): Promise<{ key: string; size: number; lastModified: Date }[]> {
  const { client, bucket } = s3();
  const out: { key: string; size: number; lastModified: Date }[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of res.Contents ?? []) out.push({ key: o.Key!, size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Writes, reads back and deletes a small object, so a wrong bucket setting shows up before anyone uploads. */
export async function checkStorage(): Promise<void> {
  const key = `.openinc/check-${randomUUID()}`;
  const body = `openinc storage check ${new Date().toISOString()}`;
  await putObject(key, body, 'text/plain');
  const read = (await getObjectBuffer(key)).toString('utf8');
  await deleteObject(key);
  if (read !== body) throw new Error('The bucket returned different content than was written');
}

/** Turns an S3 SDK error into something a person setting up the bucket can act on. */
export function describeStorageError(error: unknown): { message: string; hint: string } {
  const e = error as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number }; code?: string };
  const code = e.Code ?? e.name ?? e.code ?? '';
  const status = e.$metadata?.httpStatusCode;
  if (code === 'NoSuchBucket') return { message: `The bucket ${getEnv().S3_BUCKET} does not exist`, hint: 'Create it, or fix S3_BUCKET.' };
  if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || status === 403) {
    return {
      message: 'The bucket refused the credentials',
      hint: 'Check S3_ACCESS_KEY and S3_SECRET_KEY, and that the key may read and write the bucket.',
    };
  }
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || /getaddrinfo|ECONNREFUSED/.test(e.message ?? '')) {
    return {
      message: 'Could not reach the S3 endpoint',
      hint: 'Check S3_ENDPOINT (leave it empty for AWS) and that the service is running.',
    };
  }
  if (code === 'PermanentRedirect' || code === 'AuthorizationHeaderMalformed') {
    return { message: 'The bucket is in a different region', hint: 'Set S3_REGION to the bucket’s region.' };
  }
  return { message: `Storage check failed: ${e.message ?? code ?? 'unknown error'}`, hint: 'Check the S3_* environment variables.' };
}
