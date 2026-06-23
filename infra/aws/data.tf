resource "aws_ecr_repository" "app" {
  name                 = local.name_prefix
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "aws_db_instance" "main" {
  identifier = local.name_prefix

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.database_instance_class

  allocated_storage     = var.database_allocated_storage_gb
  max_allocated_storage = max(var.database_allocated_storage_gb, 100)
  storage_encrypted     = true

  db_name  = var.database_name
  username = var.database_username
  password = random_password.database.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false

  backup_retention_period = var.database_backup_retention_days
  deletion_protection     = var.database_deletion_protection
  skip_final_snapshot     = var.database_skip_final_snapshot
  apply_immediately       = true

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.secret_names

  name        = "${local.name_prefix}/${each.key}"
  description = "BSA app runtime secret ${each.key}"
}

resource "aws_secretsmanager_secret" "database_url" {
  name        = "${local.name_prefix}/DATABASE_URL"
  description = "BSA app Postgres connection URL generated from RDS"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgres://%s:%s@%s:%s/%s",
    var.database_username,
    urlencode(random_password.database.result),
    aws_db_instance.main.address,
    aws_db_instance.main.port,
    var.database_name,
  )
}

