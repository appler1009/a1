import { describe, it, expect, afterEach } from 'bun:test';

const ORIGINAL_AWS_PROFILE = process.env.AWS_PROFILE;

afterEach(() => {
  if (ORIGINAL_AWS_PROFILE === undefined) {
    delete process.env.AWS_PROFILE;
  } else {
    process.env.AWS_PROFILE = ORIGINAL_AWS_PROFILE;
  }
});

describe('getAwsCredentials', () => {
  it('returns undefined when AWS_PROFILE is not set', async () => {
    delete process.env.AWS_PROFILE;
    const { getAwsCredentials } = await import('../config/aws.js');
    expect(getAwsCredentials()).toBeUndefined();
  });

  it('returns a credentials provider when AWS_PROFILE is set', async () => {
    process.env.AWS_PROFILE = 'my-dev-profile';
    const { getAwsCredentials } = await import('../config/aws.js');
    expect(getAwsCredentials()).toBeTypeOf('function');
  });
});
