#!/usr/bin/env bash
set -uo pipefail

# =============================================================================
# AWS SHUTDOWN & DESTROY SCRIPT — a1 PROJECT
# =============================================================================
# ALL RESOURCE IDs HARDCODED — discovered via AWS CLI on 2026-05-10
# Account: 664281180841 | Region: us-west-2
#
# WARNING: This is IRREVERSIBLE. All data will be permanently deleted.
# Set CONFIRM_DESTROY=yes to actually execute.
# =============================================================================

# --- Toggle ------------------------------------------------------------------
CONFIRM_DESTROY="${CONFIRM_DESTROY:-no}"

# Disable AWS CLI pager so output prints directly instead of opening `less`
export AWS_PAGER=""

# --- Constants ---------------------------------------------------------------
REGION="us-west-2"
ACCOUNT="664281180841"

# --- ECS ---------------------------------------------------------------------
ECS_CLUSTER="a1"
ECS_SERVICE="a1"
ECS_TASK_FAMILY="a1"
ECS_TASK_REVISIONS=(5 6 7 8 9 10 11 12 13 14 15 16)

# --- ALB / Load Balancing ----------------------------------------------------
ALB_ARN="arn:aws:elasticloadbalancing:us-west-2:${ACCOUNT}:loadbalancer/app/a1-alb/2c3540737e6aca94"
ALB_NAME="a1-alb"
TG_ARN="arn:aws:elasticloadbalancing:us-west-2:${ACCOUNT}:targetgroup/a1-tg/f1660f4c5b1e18c0"
TG_NAME="a1-tg"
LISTENER_HTTPS="arn:aws:elasticloadbalancing:us-west-2:${ACCOUNT}:listener/app/a1-alb/2c3540737e6aca94/2e392b38767d1491"
LISTENER_HTTP="arn:aws:elasticloadbalancing:us-west-2:${ACCOUNT}:listener/app/a1-alb/2c3540737e6aca94/a22d57f09dd2524d"
LISTENER_RULE="arn:aws:elasticloadbalancing:us-west-2:${ACCOUNT}:listener-rule/app/a1-alb/2c3540737e6aca94/2e392b38767d1491/71f43b954e06d14b"

# --- ECR ---------------------------------------------------------------------
ECR_REPO="a1"

# --- Lambda ------------------------------------------------------------------
LAMBDA_SCHEDULER="a1-prod-scheduler-evaluator"
LAMBDA_SES="ses-bounce-handler"

# --- CloudWatch Logs ---------------------------------------------------------
LOG_GROUPS=(
  "/ecs/a1"
  "/aws/lambda/a1-prod-scheduler-evaluator"
  "/aws/lambda/ses-bounce-handler"
)

# --- SNS ---------------------------------------------------------------------
SNS_TOPIC_ARN="arn:aws:sns:us-west-2:${ACCOUNT}:ses-bounce-events"
SNS_SUBSCRIPTION="arn:aws:sns:us-west-2:${ACCOUNT}:ses-bounce-events:59c5a9ec-bbbc-4ef4-a25b-f3059b2de402"

# --- Secrets Manager ---------------------------------------------------------
SECRETS=(
  "a1/prod/auth-secret"
  "a1/prod/llm-keys"
  "a1/prod/oauth-google"
  "a1/prod/oauth-github"
  "a1/prod/discord"
)

# --- KMS ---------------------------------------------------------------------
KMS_KEY_ID="740e9672-0c15-4aa6-b0cc-d497d8653824"
KMS_ALIAS="alias/a1-oauth-tokens"

# --- S3 ----------------------------------------------------------------------
S3_BUCKET="appler-a1"

# --- DynamoDB ----------------------------------------------------------------
DYNAMODB_TABLES=(
  "a1_prod_credit_ledger"
  "a1_prod_groups"
  "a1_prod_invitations"
  "a1_prod_magic_link_tokens"
  "a1_prod_mcp_servers"
  "a1_prod_memberships"
  "a1_prod_memory_entities"
  "a1_prod_memory_relations"
  "a1_prod_messages"
  "a1_prod_oauth_tokens"
  "a1_prod_roles"
  "a1_prod_scheduled_jobs"
  "a1_prod_service_credentials"
  "a1_prod_sessions"
  "a1_prod_settings"
  "a1_prod_skills"
  "a1_prod_stripe_payments"
  "a1_prod_token_usage"
  "a1_prod_users"
)

# --- VPC / Networking --------------------------------------------------------
VPC_ID="vpc-03f525949a1a3baa7"
VPC_NAME="a1-vpc"
SUBNETS=(
  "subnet-02d32f9d4f890d5a9"
  "subnet-071f503f03b9e0110"
)
SECURITY_GROUPS=(
  "sg-04b1edc287d53e233"   # a1-task-sg
  "sg-0674e8b3dd6eed3ad"   # a1-alb-sg
)
IGW_ID="igw-0906e71e5e4ffc2cb"
ROUTE_TABLE_CUSTOM="rtb-0d8b44ead1a47eac7"
ROUTE_TABLE_MAIN="rtb-0d56d6310714bd5dc"
VPC_ENDPOINTS=(
  "vpce-0a4c518d649797f5d"   # dynamodb
  "vpce-077aa76917a967e56"    # s3
)
ELASTIC_IPS=(
  "eipalloc-0685bbfaa729f116e"
  "eipalloc-0a80a94afb243d3ba"
  "eipalloc-077e91ebb9b6d7d18"
)

# --- IAM Roles ---------------------------------------------------------------
# Commented out by default — uncomment the deletion loop in the IAM section
# if you are sure these are exclusive to this project.
IAM_ROLES=(
  "a1-execution-role"
  "a1-github-deploy"
  "a1-scheduler-lambda-role"
  "a1-task-role"
  "ses-bounce-handler-role"
)

# --- ACM Certificate ---------------------------------------------------------
ACM_CERT_ARN="arn:aws:acm:us-west-2:${ACCOUNT}:certificate/2d2725ad-24f0-4e4d-b8a1-3fde10681bb4"
ACM_DOMAIN="assist1.me"

# =============================================================================
# HELPERS
# =============================================================================
red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[1;33m%s\033[0m\n' "$*"; }

confirm() {
  if [[ "$CONFIRM_DESTROY" != "yes" ]]; then
    yellow "[DRY RUN] Would execute: $*"
    return 0
  fi
  echo "  → $*"
  "$@"
}

aws_cmd() {
  aws --region "$REGION" --no-paginate "$@"
}

# =============================================================================
# PRE-FLIGHT
# =============================================================================
echo ""
echo "============================================================================="
echo "  AWS DESTROY SCRIPT for a1 project"
echo "  Account: ${ACCOUNT} | Region: ${REGION}"
echo "============================================================================="
echo ""

if [[ "$CONFIRM_DESTROY" != "yes" ]]; then
  yellow "Running in DRY-RUN mode. Set CONFIRM_DESTROY=yes to actually delete."
  echo ""
fi

echo "This will destroy:"
echo "  - ECS cluster/service: ${ECS_CLUSTER}/${ECS_SERVICE}"
echo "  - ALB: ${ALB_NAME}"
echo "  - ECR repo: ${ECR_REPO}"
echo "  - 2 Lambda functions"
echo "  - 20 DynamoDB tables"
echo "  - S3 bucket: ${S3_BUCKET}"
echo "  - VPC: ${VPC_NAME} (${VPC_ID})"
echo "  - 5 Secrets"
echo "  - KMS key (7-day deletion schedule)"
echo "  - SNS topic + subscription"
echo "  - CloudWatch log groups"
echo "  - IAM roles (optional, skipped by default)"
echo ""
echo "Press Ctrl+C within 5 seconds to abort..."
sleep 5

# =============================================================================
# STEP 1: Stop & Delete ECS Service
# =============================================================================
echo ""
echo "=== STEP 1: Stop & Delete ECS Service ==="
confirm aws_cmd ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" --desired-count 0
if [[ "$CONFIRM_DESTROY" == "yes" ]]; then
  echo "Waiting for service to stabilize at 0 tasks..."
  aws_cmd ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" || true
fi
confirm aws_cmd ecs delete-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" --force

# =============================================================================
# STEP 2: Delete ECS Cluster
# =============================================================================
echo ""
echo "=== STEP 2: Delete ECS Cluster ==="
confirm aws_cmd ecs delete-cluster --cluster "$ECS_CLUSTER"

# =============================================================================
# STEP 3: Delete ALB, Listeners, Target Group
# =============================================================================
echo ""
echo "=== STEP 3: Delete ALB & Listeners ==="
# Delete listeners (default rule is auto-deleted with listener, skip explicit delete)
confirm aws_cmd elbv2 delete-listener --listener-arn "$LISTENER_HTTPS" || true
confirm aws_cmd elbv2 delete-listener --listener-arn "$LISTENER_HTTP" || true
# Delete ALB
confirm aws_cmd elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN"
if [[ "$CONFIRM_DESTROY" == "yes" ]]; then
  echo "Waiting for ALB deletion..."
  sleep 30
fi
# Delete target group
echo "=== STEP 3b: Delete Target Group ==="
confirm aws_cmd elbv2 delete-target-group --target-group-arn "$TG_ARN" || true

# =============================================================================
# STEP 4: Delete ECR Repository
# =============================================================================
echo ""
echo "=== STEP 4: Delete ECR Repository ==="
confirm aws_cmd ecr delete-repository --repository-name "$ECR_REPO" --force

# =============================================================================
# STEP 5: Delete Lambda Functions
# =============================================================================
echo ""
echo "=== STEP 5: Delete Lambda Functions ==="
confirm aws_cmd lambda delete-function --function-name "$LAMBDA_SCHEDULER" || true
confirm aws_cmd lambda delete-function --function-name "$LAMBDA_SES" || true

# =============================================================================
# STEP 6: Delete CloudWatch Log Groups
# =============================================================================
echo ""
echo "=== STEP 6: Delete CloudWatch Log Groups ==="
for lg in "${LOG_GROUPS[@]}"; do
  confirm aws_cmd logs delete-log-group --log-group-name "$lg" || true
done

# =============================================================================
# STEP 7: Deregister ECS Task Definitions
# =============================================================================
echo ""
echo "=== STEP 7: Deregister ECS Task Definitions ==="
for rev in "${ECS_TASK_REVISIONS[@]}"; do
  confirm aws_cmd ecs deregister-task-definition --task-definition "${ECS_TASK_FAMILY}:${rev}" || true
done

# =============================================================================
# STEP 8: Delete SNS Subscription & Topic
# =============================================================================
echo ""
echo "=== STEP 8: Delete SNS Subscription & Topic ==="
confirm aws_cmd sns unsubscribe --subscription-arn "$SNS_SUBSCRIPTION" || true
confirm aws_cmd sns delete-topic --topic-arn "$SNS_TOPIC_ARN" || true

# =============================================================================
# STEP 9: Delete Secrets Manager Secrets
# =============================================================================
echo ""
echo "=== STEP 9: Delete Secrets Manager Secrets ==="
for secret in "${SECRETS[@]}"; do
  confirm aws_cmd secretsmanager delete-secret --secret-id "$secret" --force-delete-without-recovery || true
done

# =============================================================================
# STEP 10: Schedule KMS Key Deletion
# =============================================================================
echo ""
echo "=== STEP 10: Schedule KMS Key Deletion ==="
yellow "WARNING: KMS key deletion has a mandatory 7-day waiting period."
confirm aws_cmd kms schedule-key-deletion --key-id "$KMS_KEY_ID" --pending-window-in-days 7 || true
# Also delete the alias so it doesn't dangle
confirm aws_cmd kms delete-alias --alias-name "$KMS_ALIAS" || true

# =============================================================================
# STEP 11: Empty & Delete S3 Bucket
# =============================================================================
echo ""
echo "=== STEP 11: Empty & Delete S3 Bucket ==="
if [[ "$CONFIRM_DESTROY" == "yes" ]]; then
  echo "Deleting all objects and versions from ${S3_BUCKET}..."
  # Delete all object versions
  versions=$(aws_cmd s3api list-object-versions --bucket "$S3_BUCKET" --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json 2>/dev/null || echo '{"Objects":[]}')
  if [[ "$(echo "$versions" | jq '.Objects | length')" -gt 0 ]]; then
    echo "$versions" | jq -c '.' | xargs -0 -I{} aws_cmd s3api delete-objects --bucket "$S3_BUCKET" --delete '{}' || true
  fi
  # Delete delete markers
  markers=$(aws_cmd s3api list-object-versions --bucket "$S3_BUCKET" --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' --output json 2>/dev/null || echo '{"Objects":[]}')
  if [[ "$(echo "$markers" | jq '.Objects | length')" -gt 0 ]]; then
    echo "$markers" | jq -c '.' | xargs -0 -I{} aws_cmd s3api delete-objects --bucket "$S3_BUCKET" --delete '{}' || true
  fi
  # Final recursive rm fallback
  aws_cmd s3 rm "s3://${S3_BUCKET}" --recursive 2>/dev/null || true
fi
confirm aws_cmd s3api delete-bucket --bucket "$S3_BUCKET" || true

# =============================================================================
# STEP 12: Delete DynamoDB Tables
# =============================================================================
echo ""
echo "=== STEP 12: Delete DynamoDB Tables ==="
for table in "${DYNAMODB_TABLES[@]}"; do
  confirm aws_cmd dynamodb delete-table --table-name "$table" || true
  if [[ "$CONFIRM_DESTROY" == "yes" ]]; then
    echo "Waiting for ${table} deletion..."
    aws_cmd dynamodb wait table-not-exists --table-name "$table" 2>/dev/null || true
  fi
done

# =============================================================================
# STEP 13: Delete VPC & Networking
# =============================================================================
echo ""
echo "=== STEP 13: Delete VPC & Networking ==="

# 13a: Release Elastic IPs
echo "Releasing Elastic IPs..."
for eip in "${ELASTIC_IPS[@]}"; do
  confirm aws_cmd ec2 release-address --allocation-id "$eip" || true
done

# 13b: Delete VPC endpoints
echo "Deleting VPC endpoints..."
for ep in "${VPC_ENDPOINTS[@]}"; do
  confirm aws_cmd ec2 delete-vpc-endpoints --vpc-endpoint-ids "$ep" || true
done

# 13c: Detach and delete IGW
echo "Detaching & deleting Internet Gateway..."
confirm aws_cmd ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID" || true
confirm aws_cmd ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID" || true

# 13d: Delete custom route table (main will be deleted with VPC)
echo "Deleting custom route table..."
confirm aws_cmd ec2 delete-route-table --route-table-id "$ROUTE_TABLE_CUSTOM" || true

# 13e: Delete security groups (retry loop because ENIs may still be releasing)
echo "Deleting security groups..."
for sg in "${SECURITY_GROUPS[@]}"; do
  # Revoke all rules first to avoid dependency issues
  ingress=$(aws_cmd ec2 describe-security-groups --group-ids "$sg" --query 'SecurityGroups[0].IpPermissions' --output json 2>/dev/null || echo '[]')
  if [[ "$ingress" != "[]" && -n "$ingress" ]]; then
    aws_cmd ec2 revoke-security-group-ingress --group-id "$sg" --ip-permissions "$ingress" 2>/dev/null || true
  fi
  egress=$(aws_cmd ec2 describe-security-groups --group-ids "$sg" --query 'SecurityGroups[0].IpPermissionsEgress' --output json 2>/dev/null || echo '[]')
  if [[ "$egress" != "[]" && -n "$egress" ]]; then
    aws_cmd ec2 revoke-security-group-egress --group-id "$sg" --ip-permissions "$egress" 2>/dev/null || true
  fi
  # Retry delete up to 10 times with 5s sleep (ENIs take time to release)
  for i in {1..10}; do
    if aws_cmd ec2 delete-security-group --group-id "$sg" 2>/dev/null; then
      break
    fi
    echo "  Security group $sg still has dependencies, retrying in 5s... ($i/10)"
    sleep 5
  done
done

# 13f: Delete subnets
echo "Deleting subnets..."
for subnet in "${SUBNETS[@]}"; do
  confirm aws_cmd ec2 delete-subnet --subnet-id "$subnet" || true
done

# 13g: Delete VPC
echo "Deleting VPC..."
confirm aws_cmd ec2 delete-vpc --vpc-id "$VPC_ID" || true

# =============================================================================
# STEP 14: Delete IAM Roles (OPTIONAL — uncomment to enable)
# =============================================================================
echo ""
echo "=== STEP 14: Delete IAM Roles (SKIPPED by default) ==="
echo "The following IAM roles were discovered but NOT deleted:"
for role in "${IAM_ROLES[@]}"; do
  echo "  - $role"
done
echo ""
echo "To delete them, uncomment the loop below in the script."
# for role in "${IAM_ROLES[@]}"; do
#   # Detach all managed policies first
#   policies=$(aws_cmd iam list-attached-role-policies --role-name "$role" --query 'AttachedPolicies[*].PolicyArn' --output text 2>/dev/null || true)
#   for policy in $policies; do
#     aws_cmd iam detach-role-policy --role-name "$role" --policy-arn "$policy" 2>/dev/null || true
#   done
#   # Delete inline policies
#   inline=$(aws_cmd iam list-role-policies --role-name "$role" --query 'PolicyNames[*]' --output text 2>/dev/null || true)
#   for p in $inline; do
#     aws_cmd iam delete-role-policy --role-name "$role" --policy-name "$p" 2>/dev/null || true
#   done
#   confirm aws_cmd iam delete-role --role-name "$role" || true
# done

# =============================================================================
# STEP 15: Delete ACM Certificate (OPTIONAL — uncomment to enable)
# =============================================================================
echo ""
echo "=== STEP 15: Delete ACM Certificate (SKIPPED by default) ==="
echo "Certificate found: ${ACM_CERT_ARN} (${ACM_DOMAIN})"
echo "Skipped — may be reused if you revive the project on the same domain."
echo "To delete, uncomment the line below in the script."
# confirm aws_cmd acm delete-certificate --certificate-arn "$ACM_CERT_ARN" || true

# =============================================================================
# DONE
# =============================================================================
echo ""
echo "============================================================================="
if [[ "$CONFIRM_DESTROY" == "yes" ]]; then
  green "DESTROY COMPLETE."
  echo ""
  echo "All AWS resources for the a1 project have been deleted."
  echo "Note: KMS key ${KMS_KEY_ID} is scheduled for deletion in 7 days."
  echo "      To cancel, run: aws kms cancel-key-deletion --key-id ${KMS_KEY_ID}"
else
  yellow "DRY RUN COMPLETE."
  echo ""
  echo "No resources were actually deleted."
  echo "Set CONFIRM_DESTROY=yes and re-run to execute the destruction."
fi
echo "============================================================================="
echo ""
