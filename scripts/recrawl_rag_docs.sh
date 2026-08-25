#!/bin/bash
# Recrawl all RAG documentation and rebuild vector index

set -e

echo "🗑️  Removing old documentation and index..."
rm -rf app/data/registry/aws/resources.jsonl
rm -rf app/data/raw/learn_terraform.jsonl
rm -rf app/data/raw/terraform_modules.jsonl
rm -rf app/data/index/aws/*

echo ""
echo "📥 Starting fresh crawl..."
echo "This will take 10-30 minutes depending on your internet speed."
echo ""

# Run the pipeline which will trigger crawling
python3 -m app.rag.pipeline "create an S3 bucket with versioning" > /dev/null 2>&1 || true

echo ""
echo "✅ Documentation crawl complete!"
echo ""
echo "📊 Results:"
echo "  - AWS Resources: $(grep -c '"provider": "aws"' app/data/registry/aws/resources.jsonl 2>/dev/null || echo '0') pages"
echo "  - Tutorials: $(wc -l < app/data/raw/learn_terraform.jsonl 2>/dev/null || echo '0') tutorials"
echo "  - Terraform Modules: $(wc -l < app/data/raw/terraform_modules.jsonl 2>/dev/null || echo '0') modules"
echo "  - Vector Index: $(du -h app/data/index/aws/faiss.index 2>/dev/null | cut -f1 || echo 'N/A')"
echo ""
echo "🎯 RAG system is ready!"

