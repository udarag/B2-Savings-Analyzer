import nextEnv from '@next/env';
import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const args = parseArgs(process.argv.slice(2));
const region = args.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
const profile = args.profile || process.env.AWS_PROFILE;
const terraformBin = args.terraformBin || process.env.TERRAFORM_BIN || 'terraform';
const terraformVarsPath = args.tfvars || 'infra/aws/terraform.tfvars';

const requiredSecrets = [
  'B2_ENDPOINT',
  'B2_REGION',
  'B2_KEY_ID',
  'B2_APP_KEY',
  'B2_BUCKET_NAME',
  'AUTH_SECRET',
  'RESEND_API_KEY',
];

const results = [];

check('AWS identity', () => {
  const identity = awsJson(['sts', 'get-caller-identity', '--output', 'json']);
  return pass(`${identity.Account} (${identity.Arn})`);
});

check('AWS region', () => {
  const configuredRegion = run('aws', awsArgs(['configure', 'get', 'region']), { optional: true });
  const source = args.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
    ? 'explicit/env'
    : configuredRegion.stdout.trim()
      ? 'aws-config'
      : 'defaulted';

  if (!configuredRegion.stdout.trim() && !args.region && !process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
    return warn(`${region} (${source}); consider running: aws configure set region ${region}`);
  }

  return pass(`${region} (${source})`);
});

check('Terraform version', () => {
  const version = run(terraformBin, ['version', '-json'], { optional: true });
  if (version.status !== 0) {
    return fail(`${terraformBin} is not usable`);
  }

  const parsed = JSON.parse(version.stdout);
  const current = parsed.terraform_version;
  if (compareVersions(current, '1.6.0') < 0) {
    return fail(`${current}; install Terraform 1.6+ or set TERRAFORM_BIN to a newer binary`);
  }

  return pass(current);
});

check('Docker daemon', () => {
  const docker = run('docker', ['info', '--format', '{{.ServerVersion}}'], { optional: true });
  if (docker.status !== 0) {
    return warn('Docker is not reachable; start Docker Desktop before building the image');
  }

  return pass(docker.stdout.trim());
});

check('Terraform variables file', () => {
  if (!existsSync(terraformVarsPath)) {
    return warn(`${terraformVarsPath} is missing; copy infra/aws/terraform.tfvars.example and fill in app_base_url/certificate_arn`);
  }

  const body = readFileSync(terraformVarsPath, 'utf8');
  const placeholders = ['replace-me', 'bsa.example.internal'];
  const foundPlaceholders = placeholders.filter((value) => body.includes(value));

  if (foundPlaceholders.length > 0) {
    return warn(`${terraformVarsPath} still contains placeholder values: ${foundPlaceholders.join(', ')}`);
  }

  return pass(terraformVarsPath);
});

check('Required runtime secrets', () => {
  const missing = requiredSecrets.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    return fail(`missing in .env.local: ${missing.join(', ')}`);
  }

  return pass(`${requiredSecrets.length} required values present`);
});

check('ACM certificates in region', () => {
  const certificates = awsJson([
    'acm',
    'list-certificates',
    '--region',
    region,
    '--certificate-statuses',
    'ISSUED',
    'PENDING_VALIDATION',
    '--output',
    'json',
  ]);
  const summaries = certificates.CertificateSummaryList || [];
  const issued = summaries.filter((certificate) => certificate.Status === 'ISSUED');

  if (issued.length === 0) {
    return warn(`no issued ACM certificates in ${region}; HTTPS needs a certificate before app login works`);
  }

  return pass(issued.map((certificate) => certificate.DomainName).join(', '));
});

check('Route 53 hosted zones', () => {
  const zones = awsJson(['route53', 'list-hosted-zones', '--output', 'json']);
  const hostedZones = zones.HostedZones || [];

  if (hostedZones.length === 0) {
    return warn('no hosted zones in this account; DNS/certificate validation likely needs external Backblaze DNS help');
  }

  return pass(hostedZones.map((zone) => zone.Name).join(', '));
});

for (const result of results) {
  const marker = result.level === 'pass' ? 'PASS' : result.level === 'warn' ? 'WARN' : 'FAIL';
  console.log(`${marker} ${result.name}: ${result.message}`);
}

const failures = results.filter((result) => result.level === 'fail');
const warnings = results.filter((result) => result.level === 'warn');

if (failures.length > 0) {
  console.error(`\nPreflight failed with ${failures.length} blocking issue(s).`);
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn(`\nPreflight completed with ${warnings.length} warning(s).`);
} else {
  console.log('\nPreflight passed without warnings.');
}

function check(name, fn) {
  try {
    results.push({ name, ...fn() });
  } catch (error) {
    results.push(fail(error.message, name));
  }
}

function pass(message) {
  return { level: 'pass', message };
}

function warn(message) {
  return { level: 'warn', message };
}

function fail(message, name = undefined) {
  return { level: 'fail', name, message };
}

function awsJson(command) {
  const result = run('aws', awsArgs(command), { optional: true });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `aws ${command.join(' ')} failed`);
  }
  return JSON.parse(result.stdout);
}

function awsArgs(command) {
  const fullCommand = [...command];
  if (profile) {
    fullCommand.unshift('--profile', profile);
  }
  return fullCommand;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
  });

  if (!options.optional && result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} ${commandArgs.join(' ')} failed`);
  }

  return result;
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;

    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
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
    } else if (arg === '--terraform-bin' && next) {
      parsed.terraformBin = next;
      index += 1;
    } else if (arg === '--tfvars' && next) {
      parsed.tfvars = next;
      index += 1;
    }
  }

  return parsed;
}
