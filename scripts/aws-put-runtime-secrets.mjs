import nextEnv from '@next/env';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const args = parseArgs(process.argv.slice(2));
const region = args.region || process.env.AWS_REGION || 'us-west-2';
const profile = args.profile || process.env.AWS_PROFILE;
const secretPrefix = args.secretPrefix || process.env.BSA_AWS_SECRET_PREFIX || 'bsa-v2-dev';
const terraformDir = args.terraformDir || process.env.TERRAFORM_DIR || 'infra/aws';
const terraformBin = args.terraformBin || process.env.TERRAFORM_BIN || 'terraform';

const requiredSecrets = [
  'B2_ENDPOINT',
  'B2_REGION',
  'B2_KEY_ID',
  'B2_APP_KEY',
  'B2_BUCKET_NAME',
  'AUTH_SECRET',
  'RESEND_API_KEY',
];

const terraformSecretNames = loadTerraformSecretNames(terraformDir);

for (const name of requiredSecrets) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required in .env.local before uploading AWS runtime secrets.`);
  }

  const secretId = terraformSecretNames?.[name] || `${secretPrefix}/${name}`;
  await putSecretValue({
    region,
    profile,
    secretId,
    value,
  });
  console.log(`Updated ${secretId}`);
}

function loadTerraformSecretNames(dir) {
  const result = spawnSync(terraformBin, [`-chdir=${dir}`, 'output', '-json'], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    console.warn(`Terraform outputs unavailable; falling back to --secret-prefix ${secretPrefix}.`);
    return null;
  }

  const outputs = JSON.parse(result.stdout);
  return outputs.app_secret_names?.value || null;
}

async function putSecretValue({ region, profile, secretId, value }) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'bsa-secret-'));
  const secretPath = path.join(tempDir, 'value.txt');

  try {
    await writeFile(secretPath, value, { mode: 0o600 });
    const command = [
      'secretsmanager',
      'put-secret-value',
      '--region',
      region,
      '--secret-id',
      secretId,
      '--secret-string',
      `file://${secretPath}`,
    ];

    if (profile) {
      command.unshift('--profile', profile);
    }

    const result = spawnSync('aws', command, {
      stdio: 'inherit',
    });

    if (result.status !== 0) {
      throw new Error(`aws ${command.join(' ')} failed with status ${result.status}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--region' && next) {
      parsed.region = next;
      index += 1;
    } else if (arg === '--profile' && next) {
      parsed.profile = next;
      index += 1;
    } else if (arg === '--secret-prefix' && next) {
      parsed.secretPrefix = next;
      index += 1;
    } else if (arg === '--terraform-dir' && next) {
      parsed.terraformDir = next;
      index += 1;
    } else if (arg === '--terraform-bin' && next) {
      parsed.terraformBin = next;
      index += 1;
    }
  }

  return parsed;
}
