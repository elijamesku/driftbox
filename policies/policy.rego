package main

# Conftest convention: any deny[msg] triggers a failure.

allowed_resources := {"aws_s3_bucket", "aws_iam_user", "aws_dynamodb_table"}
ddb_allowed_types := {"S", "N", "B"}

valid_name(name) {
  re_match("^[a-z0-9_.-]+$", name)
  not startswith(name, "admin")
  not startswith(name, "root")
  not startswith(name, "prod-unsafe")
  not startswith(name, "public-")
}

# -------- Global checks --------

deny[msg] {
  not input.resource
  msg := "missing resource"
}

deny[msg] {
  input.resource
  not allowed_resources[input.resource]
  msg := sprintf("unsupported resource: %v", [input.resource])
}

deny[msg] {
  not input.name
  msg := "missing name"
}

deny[msg] {
  input.name
  not valid_name(input.name)
  msg := sprintf("invalid or unsafe name: %v", [input.name])
}

# -------- S3 rules --------

deny[msg] {
  input.resource == "aws_s3_bucket"
  not input.properties.block_public_access
  msg := "public buckets are blocked (block_public_access must be true)"
}

# -------- DynamoDB rules --------

deny[msg] {
  input.resource == "aws_dynamodb_table"
  not input.properties.hash_key_type
  msg := "dynamodb requires hash_key_type"
}

deny[msg] {
  input.resource == "aws_dynamodb_table"
  t := input.properties.hash_key_type
  not ddb_allowed_types[t]
  msg := sprintf("invalid dynamodb hash_key_type: %v (must be S/N/B)", [t])
}
