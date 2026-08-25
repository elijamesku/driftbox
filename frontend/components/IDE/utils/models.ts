

export const GITHUB_ACTIONS_TEMPLATES = {
    'terraform-plan': {
      name: 'Terraform Plan',
      description: 'Run terraform plan on pull requests',
      category: 'terraform',
      template: `name: Terraform Plan
  on:
    pull_request:
      branches: [main, master]
      paths: ['**.tf', '**.tfvars']
  permissions:
    contents: read
    pull-requests: write
  jobs:
    terraform-plan:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: hashicorp/setup-terraform@v3
          with:
            terraform_version: 1.6.0
        - run: terraform init
        - run: terraform plan -no-color
          continue-on-error: true`
    },
    'terraform-apply': {
      name: 'Terraform Apply',
      description: 'Apply terraform changes on merge to main',
      category: 'terraform',
      template: `name: Terraform Apply
  on:
    push:
      branches: [main, master]
      paths: ['**.tf', '**.tfvars']
  permissions:
    contents: read
  jobs:
    terraform-apply:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: hashicorp/setup-terraform@v3
          with:
            terraform_version: 1.6.0
        - run: terraform init
        - run: terraform apply -auto-approve`
    },
    'terraform-oidc-aws': {
      name: 'Terraform with AWS OIDC',
      description: 'Secure AWS authentication using OIDC (no secrets needed)',
      category: 'terraform',
      template: `name: Terraform with AWS OIDC
  on:
    push:
      branches: [main, master]
    pull_request:
      branches: [main, master]
  # Configure in GitHub Settings > Secrets and variables > Actions > Variables:
  #   AWS_ROLE_ARN: arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_ROLE_NAME
  #   AWS_REGION: us-east-1
  permissions:
    id-token: write
    contents: read
    pull-requests: write
  env:
    AWS_ROLE_ARN: \${{ vars.AWS_ROLE_ARN || 'arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME' }}
    AWS_REGION: \${{ vars.AWS_REGION || 'us-east-1' }}
  jobs:
    terraform:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: aws-actions/configure-aws-credentials@v4
          with:
            role-to-assume: \${{ env.AWS_ROLE_ARN }}
            aws-region: \${{ env.AWS_REGION }}
        - uses: hashicorp/setup-terraform@v3
        - run: terraform init
        - if: github.event_name == 'pull_request'
          run: terraform plan -no-color
        - if: github.ref == 'refs/heads/main' && github.event_name == 'push'
          run: terraform apply -auto-approve`
    },
    'terraform-digitalocean': {
      name: 'Terraform with DigitalOcean',
      description: 'Deploy to DigitalOcean with smart duplicate detection',
      category: 'terraform',
      template: `name: Terraform with DigitalOcean
  on:
    push:
      branches: [main, master]
    pull_request:
      branches: [main, master]
  # Configure in GitHub Settings > Secrets and variables > Actions > Secrets:
  #   DIGITALOCEAN_TOKEN: Your DigitalOcean API token
  permissions:
    contents: read
    pull-requests: write
  env:
    DIGITALOCEAN_TOKEN: \${{ secrets.DIGITALOCEAN_TOKEN }}
  jobs:
    terraform:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        
        - name: Check for duplicate resources
          id: check-duplicates
          run: |
            echo "🔍 Checking for existing DigitalOcean resources..."
            
            # Get existing VPCs
            EXISTING_VPCS=$(curl -s -H "Authorization: Bearer \$DIGITALOCEAN_TOKEN" \\
              "https://api.digitalocean.com/v2/vpcs" | jq -r '.vpcs[] | "\\(.name): \\(.ip_range)"' || echo "")
            echo "Existing VPCs:"
            echo "\$EXISTING_VPCS"
            
            # Find next available CIDR (10.0.0.0/16 through 10.255.0.0/16)
            USED_CIDRS=$(curl -s -H "Authorization: Bearer \$DIGITALOCEAN_TOKEN" \\
              "https://api.digitalocean.com/v2/vpcs" | jq -r '.vpcs[].ip_range' || echo "")
            
            AVAILABLE_CIDR=""
            for i in \$(seq 0 255); do
              TEST_CIDR="10.\$i.0.0/16"
              if ! echo "\$USED_CIDRS" | grep -q "\$TEST_CIDR"; then
                echo "✅ Available CIDR: \$TEST_CIDR"
                AVAILABLE_CIDR="\$TEST_CIDR"
                echo "AVAILABLE_CIDR=\$TEST_CIDR" >> \$GITHUB_ENV
                break
              fi
            done
            
            # Auto-fix hardcoded CIDRs in Terraform files
            if [ -n "\$AVAILABLE_CIDR" ]; then
              echo "🔧 Updating hardcoded CIDRs in .tf files..."
              for tf_file in *.tf; do
                if [ -f "\$tf_file" ]; then
                  # Replace common hardcoded CIDRs with available one
                  sed -i "s|ip_range\\s*=\\s*\\"10\\.0\\.0\\.0/16\\"|ip_range = \\"\$AVAILABLE_CIDR\\"|g" "\$tf_file"
                  sed -i "s|ip_range\\s*=\\s*\\"10\\.1\\.0\\.0/16\\"|ip_range = \\"\$AVAILABLE_CIDR\\"|g" "\$tf_file"
                  sed -i "s|ip_range\\s*=\\s*\\"10\\.10\\.0\\.0/16\\"|ip_range = \\"\$AVAILABLE_CIDR\\"|g" "\$tf_file"
                fi
              done
              echo "✅ TF files updated with available CIDR: \$AVAILABLE_CIDR"
              grep -r "ip_range" *.tf || true
            fi
        
        - uses: hashicorp/setup-terraform@v3
          with:
            terraform_version: 1.6.0
        
        - name: Terraform Init
          run: terraform init
        
        - name: Terraform Plan
          if: github.event_name == 'pull_request'
          run: terraform plan -no-color
        
        - name: Terraform Apply
          if: github.ref == 'refs/heads/main' && github.event_name == 'push'
          run: terraform apply -auto-approve`
    },
    'terraform-oidc-azure': {
      name: 'Terraform with Azure OIDC',
      description: 'Secure Azure authentication using Federated Credentials',
      category: 'terraform',
      template: `name: Terraform with Azure OIDC
  on:
    push:
      branches: [main, master]
    pull_request:
      branches: [main, master]
  # Configure in GitHub Settings > Secrets and variables > Actions > Variables:
  #   AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID
  permissions:
    id-token: write
    contents: read
    pull-requests: write
  env:
    ARM_CLIENT_ID: \${{ vars.AZURE_CLIENT_ID }}
    ARM_TENANT_ID: \${{ vars.AZURE_TENANT_ID }}
    ARM_SUBSCRIPTION_ID: \${{ vars.AZURE_SUBSCRIPTION_ID }}
    ARM_USE_OIDC: true
  jobs:
    terraform:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: azure/login@v2
          with:
            client-id: \${{ env.ARM_CLIENT_ID }}
            tenant-id: \${{ env.ARM_TENANT_ID }}
            subscription-id: \${{ env.ARM_SUBSCRIPTION_ID }}
        - uses: hashicorp/setup-terraform@v3
        - run: terraform init
        - if: github.event_name == 'pull_request'
          run: terraform plan -no-color
        - if: github.ref == 'refs/heads/main' && github.event_name == 'push'
          run: terraform apply -auto-approve`
    },
    'terraform-security': {
      name: 'Terraform Security Scan',
      description: 'Run security checks with tfsec and checkov',
      category: 'security',
      template: `name: Terraform Security Scan
  on:
    pull_request:
      branches: [main, master]
      paths: ['**.tf']
  jobs:
    security-scan:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: aquasecurity/tfsec-action@v1.0.0
          with:
            soft_fail: true
        - uses: bridgecrewio/checkov-action@v12
          with:
            directory: .
            framework: terraform
            soft_fail: true`
    },
    'terraform-docs': {
      name: 'Terraform Docs',
      description: 'Auto-generate documentation from Terraform',
      category: 'docs',
      template: `name: Terraform Docs
  on:
    pull_request:
      branches: [main, master]
      paths: ['**.tf']
  permissions:
    contents: write
    pull-requests: write
  jobs:
    docs:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
          with:
            ref: \${{ github.event.pull_request.head.ref }}
        - uses: terraform-docs/gh-actions@v1.0.0
          with:
            working-dir: .
            output-file: README.md
            output-method: inject
            git-push: "true"`
    },
    'infracost': {
      name: 'Infracost',
      description: 'Show cloud cost estimates in pull requests',
      category: 'cost',
      template: `name: Infracost
  on:
    pull_request:
      branches: [main, master]
      paths: ['**.tf', '**.tfvars']
  # Add INFRACOST_API_KEY to repository secrets
  # Get free key at: https://www.infracost.io/
  permissions:
    contents: read
    pull-requests: write
  jobs:
    infracost:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: infracost/actions/setup@v3
          with:
            api-key: \${{ secrets.INFRACOST_API_KEY }}
        - run: infracost breakdown --path=. --format=json --out-file=/tmp/infracost.json
        - run: |
            infracost comment github --path=/tmp/infracost.json \\
              --repo=\${{ github.repository }} \\
              --github-token=\${{ github.token }} \\
              --pull-request=\${{ github.event.pull_request.number }} \\
              --behavior=update`
    }
  }