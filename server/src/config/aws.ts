import { fromIni } from '@aws-sdk/credential-providers';

/**
 * Returns a credentials provider for the AWS profile named in AWS_PROFILE,
 * or undefined to let the SDK use its default credential chain (env vars,
 * instance metadata, etc.).
 *
 * Intended for local development only — in production the instance role or
 * task role provides credentials automatically.
 */
export function getAwsCredentials(): ReturnType<typeof fromIni> | undefined {
  const profile = process.env.AWS_PROFILE;
  if (!profile) return undefined;
  return fromIni({ profile });
}
