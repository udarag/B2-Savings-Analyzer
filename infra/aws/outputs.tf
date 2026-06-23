output "aws_region" {
  value = var.aws_region
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "alb_dns_name" {
  value = aws_lb.app.dns_name
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "ecs_task_definition_arn" {
  value = aws_ecs_task_definition.app.arn
}

output "app_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "app_security_group_id" {
  value = aws_security_group.app.id
}

output "rds_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "database_url_secret_name" {
  value = aws_secretsmanager_secret.database_url.name
}

output "app_secret_names" {
  value = {
    for name, secret in aws_secretsmanager_secret.app : name => secret.name
  }
}
