#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-west-2}"
TAG="${IMAGE_TAG:-latest}"
PLATFORM="${DOCKER_PLATFORM:-linux/arm64}"
TERRAFORM_DIR="${TERRAFORM_DIR:-infra/aws}"

if [[ -z "${ECR_REPOSITORY_URL:-}" ]]; then
  ECR_REPOSITORY_URL="$(terraform -chdir="$TERRAFORM_DIR" output -raw ecr_repository_url)"
fi

REGISTRY="${ECR_REPOSITORY_URL%/*}"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

docker buildx build \
  --platform "$PLATFORM" \
  --tag "${ECR_REPOSITORY_URL}:${TAG}" \
  --push \
  .

echo "Pushed ${ECR_REPOSITORY_URL}:${TAG}"
