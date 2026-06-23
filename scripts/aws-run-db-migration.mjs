import { spawnSync } from 'child_process';

const args = parseArgs(process.argv.slice(2));
const terraformDir = args.terraformDir || process.env.TERRAFORM_DIR || 'infra/aws';
const region = args.region || process.env.AWS_REGION || 'us-west-2';
const profile = args.profile || process.env.AWS_PROFILE;

const outputs = terraformOutput(terraformDir);
const cluster = outputValue(outputs, 'ecs_cluster_name');
const taskDefinition = outputValue(outputs, 'ecs_task_definition_arn');
const subnetIds = outputValue(outputs, 'app_subnet_ids');
const securityGroupId = outputValue(outputs, 'app_security_group_id');
const migrationCommand = ['node', 'scripts/db-migrate.mjs'];

if (!Array.isArray(subnetIds) || subnetIds.length === 0) {
  throw new Error('Terraform output app_subnet_ids must contain at least one subnet.');
}

const runTaskOutput = awsJson([
  'ecs',
  'run-task',
  '--region',
  region,
  '--cluster',
  cluster,
  '--task-definition',
  taskDefinition,
  '--launch-type',
  'FARGATE',
  '--network-configuration',
  `awsvpcConfiguration={subnets=[${subnetIds.join(',')}],securityGroups=[${securityGroupId}],assignPublicIp=ENABLED}`,
  '--overrides',
  JSON.stringify({
    containerOverrides: [
      {
        name: 'app',
        command: migrationCommand,
      },
    ],
  }),
  '--started-by',
  'bsa-db-migration',
]);

const failures = runTaskOutput.failures || [];
if (failures.length > 0) {
  throw new Error(`ecs run-task returned failures: ${JSON.stringify(failures)}`);
}

const taskArn = runTaskOutput.tasks?.[0]?.taskArn;
if (!taskArn) {
  throw new Error('ecs run-task did not return a task ARN.');
}

console.log(`Started migration task: ${taskArn}`);

aws([
  'ecs',
  'wait',
  'tasks-stopped',
  '--region',
  region,
  '--cluster',
  cluster,
  '--tasks',
  taskArn,
]);

const taskDescription = awsJson([
  'ecs',
  'describe-tasks',
  '--region',
  region,
  '--cluster',
  cluster,
  '--tasks',
  taskArn,
]);

const task = taskDescription.tasks?.[0];
const appContainer = task?.containers?.find((container) => container.name === 'app');
const exitCode = appContainer?.exitCode;

if (exitCode !== 0) {
  throw new Error(
    `Migration task stopped with exit code ${exitCode ?? 'unknown'}: ${appContainer?.reason || task?.stoppedReason || 'no reason reported'}`,
  );
}

console.log('Migration completed successfully.');

function terraformOutput(dir) {
  const result = spawnSync('terraform', [`-chdir=${dir}`, 'output', '-json'], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || `terraform output failed with status ${result.status}`);
  }

  return JSON.parse(result.stdout);
}

function outputValue(outputs, name) {
  const output = outputs[name];
  if (!output) {
    throw new Error(`Missing Terraform output: ${name}`);
  }
  return output.value;
}

function awsJson(command) {
  const result = aws([...command, '--output', 'json'], { encoding: 'utf8' });
  return JSON.parse(result.stdout);
}

function aws(command, options = {}) {
  const fullCommand = [...command];
  if (profile) {
    fullCommand.unshift('--profile', profile);
  }

  const result = spawnSync('aws', fullCommand, {
    stdio: options.encoding ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    encoding: options.encoding,
  });

  if (result.status !== 0) {
    throw new Error(`aws ${fullCommand.join(' ')} failed with status ${result.status}`);
  }

  return result;
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--terraform-dir' && next) {
      parsed.terraformDir = next;
      index += 1;
    } else if (arg === '--region' && next) {
      parsed.region = next;
      index += 1;
    } else if (arg === '--profile' && next) {
      parsed.profile = next;
      index += 1;
    }
  }

  return parsed;
}
