locals {
  name_prefix = "${var.project_name}-${var.environment}"

  availability_zones = [
    "${var.aws_region}a",
    "${var.aws_region}b",
  ]

  secret_names = toset([
    "B2_ENDPOINT",
    "B2_REGION",
    "B2_KEY_ID",
    "B2_APP_KEY",
    "B2_BUCKET_NAME",
    "AUTH_SECRET",
    "RESEND_API_KEY",
  ])

  app_environment = [
    {
      name  = "NODE_ENV"
      value = "production"
    },
    {
      name  = "HOSTNAME"
      value = "0.0.0.0"
    },
    {
      name  = "PORT"
      value = "3000"
    },
    {
      name  = "NEXT_PUBLIC_BASE_URL"
      value = var.app_base_url
    },
    {
      name  = "DATABASE_STORAGE_ENABLED"
      value = "true"
    },
    {
      name  = "DATABASE_SSL"
      value = "true"
    },
    {
      name  = "DATABASE_SSL_REJECT_UNAUTHORIZED"
      value = "true"
    },
    {
      name  = "DATABASE_POOL_MAX"
      value = "5"
    },
    {
      name  = "ALLOWED_EMAIL_DOMAIN"
      value = var.allowed_email_domain
    },
    {
      name  = "EMAIL_FROM"
      value = var.email_from
    },
  ]

  app_secret_environment = concat(
    [
      {
        name      = "DATABASE_URL"
        valueFrom = aws_secretsmanager_secret.database_url.arn
      }
    ],
    [
      for name, secret in aws_secretsmanager_secret.app : {
        name      = name
        valueFrom = secret.arn
      }
    ]
  )

  tags = {
    Project     = "B2 Savings Analyzer"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

