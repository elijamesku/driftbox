# tests/test_ir_and_policy.py
import pytest
from fastapi import HTTPException
from schema import policy_validate, summarize_details
from schema import opa_check

def test_policy_validates_good_ir():
    good = {
        "resource": "aws_s3_bucket",
        "name": "logs-bucket",
        "properties": {"versioning": True, "block_public_access": True, "region": "us-east-1"},
        "actions": ["plan"]
    }
    # Should not raise
    policy_validate(good)

def test_policy_blocks_public():
    bad = {
        "resource": "aws_s3_bucket",
        "name": "public-bucket",
        "properties": {"versioning": True, "block_public_access": False, "region": "us-east-1"},
        "actions": ["plan"]
    }
    with pytest.raises(HTTPException) as exc:
        policy_validate(bad)
    detail = str(exc.value.detail)
    # Accept either unsafe prefix or public bucket rule
    assert ("Public buckets" in detail) or ("unsafe_name_prefix" in detail)

def test_policy_blocks_invalid_name():
    bad = {
        "resource": "aws_s3_bucket",
        "name": "BadName!",
        "properties": {"versioning": True, "block_public_access": True, "region": "us-east-1"},
        "actions": ["plan"]
    }
    with pytest.raises(HTTPException) as exc:
        policy_validate(bad)
    assert "invalid_name" in str(exc.value.detail)

def test_policy_allows_dynamodb():
    good = {
        "resource": "aws_dynamodb_table",
        "name": "events-table",
        "properties": {"region": "us-east-1", "hash_key": "pk", "hash_key_type": "S"},
        "actions": ["plan"]
    }
    policy_validate(good)

def test_opa_blocks_public_prefix():
    ir = {
        "resource": "aws_s3_bucket",
        "name": "public-bucket",
        "properties": {"versioning": True, "block_public_access": True, "region": "us-east-1"},
        "actions": ["plan"]
    }
    with pytest.raises(HTTPException):
        opa_check(ir)

def test_opa_blocks_public_access_flag():
    ir = {
        "resource": "aws_s3_bucket",
        "name": "logs-bucket",
        "properties": {"versioning": True, "block_public_access": False, "region": "us-east-1"},
        "actions": ["plan"]
    }
    with pytest.raises(HTTPException) as exc:
        opa_check(ir)
    assert "S3 public access is not allowed" in str(exc.value.detail)


# 
def test_summarize_details_parses():
    sample = """# aws_s3_bucket.logs_bucket will be created
Plan: 1 to add, 0 to change, 0 to destroy."""
    d = summarize_details(sample)
    assert d and d[0]["address"] == "aws_s3_bucket.logs_bucket" and "created" in d[0]["action"]
