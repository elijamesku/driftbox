"""
Intelligent prompt validation inspired by Cursor's contextual approach.
Permits technical discussions while filtering off-topic queries.
"""
import re
from typing import Dict, Optional


class IntelligentPromptValidator:
    """
    Context-aware prompt validator understanding technical intent.
    Mirrors Cursor's approach - permissive for infrastructure content, strict for irrelevance.
    """
    
    # Infrastructure and DevOps terminology (comprehensive set)
    INFRASTRUCTURE_VOCABULARY = {
        # Cloud provider services
        'aws', 'azure', 'gcp', 'cloud', 'ec2', 's3', 'lambda', 'vpc', 'rds', 'dynamodb',
        'iam', 'cloudfront', 'route53', 'elb', 'alb', 'eks', 'ecs', 'fargate',
        'bucket', 'instance', 'subnet', 'security', 'firewall', 'load balancer',
        
        # Infrastructure as Code concepts
        'terraform', 'infrastructure', 'iac', 'resource', 'module', 'provider',
        'deployment', 'provision', 'orchestration', 'configuration',
        
        # DevOps and operations terminology
        'deploy', 'server', 'container', 'kubernetes', 'docker', 'cicd', 'pipeline',
        'monitoring', 'logging', 'metric', 'alert', 'backup', 'disaster recovery',
        
        # Networking and security
        'network', 'dns', 'ssl', 'tls', 'certificate', 'encryption', 'firewall',
        'cidr', 'ip', 'port', 'protocol', 'ingress', 'egress', 'vpn', 'nat',
        
        # Architecture and scaling concepts
        'architecture', 'scaling', 'availability', 'redundancy', 'failover',
        'database', 'storage', 'compute', 'api', 'endpoint', 'region', 'zone',
    }
    
    # Inquiry and discussion patterns (acceptable for technical questions)
    TECHNICAL_INQUIRY_PATTERNS = [
        r'\bhow (do|can|should|would) (i|we)\b',
        r'\bwhat (is|are|should|would|if)\b',
        r'\bwhy (is|are|should|would|does)\b',
        r'\bwhen (should|would|can|do)\b',
        r'\bshould (i|we)\b',
        r'\bcan (i|we|you)\b',
        r'\bbest (practice|way|approach)\b',
        r'\brecommend',
        r'\bexplain',
        r'\bhelp (me|us) (with|understand)\b',
        r'\bshow (me|us)\b',
    ]
    
    # Non-technical patterns requiring rejection
    IRRELEVANT_CONTENT_PATTERNS = [
        # Minimal greetings without context
        r'^(hello|hi|hey|howdy|yo|sup)[\s\.\!]*$',
        r'^how are you[\s\?\!]*$',
        r'^what\'?s up[\s\?\!]*$',
        r'^good (morning|afternoon|evening|night)[\s\.\!]*$',
        
        # People/celebrity questions (CRITICAL: Block "who is donald trump" etc)
        r'^who (is|was|are|were)\s+[A-Z]',  # "who is Donald Trump"
        r'\btell me about\s+[A-Z][a-z]+\s+[A-Z]',  # "tell me about Donald Trump"
        r'\b(celebrity|famous person|politician|actor|actress|singer)\b',
        r'\b(president|prime minister|governor|senator|congressman)\b.*\?(?!.*\b(aws|terraform|cloud|infrastructure)\b)',  # Block unless AWS-related
        
        # Completely unrelated topics
        r'\b(weather|temperature|forecast|sunny|rainy|cloudy)\b.*\?',
        r'\b(movie|film|tv show|netflix|youtube|video game)\b',
        r'\b(sports|football|basketball|soccer|baseball|nfl|nba)\b',
        r'\b(recipe|cooking|food|restaurant|meal)\b',
        r'\b(joke|funny|humor|laugh)\b',
        r'\b(dating|relationship|girlfriend|boyfriend)\b',
        r'\b(music|song|artist|album|concert)\b.*\?',
        r'\b(news|current events|politics)\b.*\?(?!.*\b(aws|terraform|cloud)\b)',  # Block unless cloud-related
        
        # General knowledge questions (unless infrastructure-related)
        r'^what is\s+(the\s+)?capital\b',  # "what is the capital of..."
        r'^when (did|was|were|is)\b(?!.*(terraform|aws|cloud))',  # "when did X happen" (unless cloud-related)
        r'^where (is|are|was|were)\b(?!.*(region|availability zone|data center|aws|cloud))',  # Allow "where is us-east-1"
        
        # Social pleasantries
        r'^(thanks|thank you|thx)[\s\.\!]*$',
        r'^(sorry|my bad|apologize)[\s\.\!]*$',
        r'^(bye|goodbye|see you|cya)[\s\.\!]*$',
    ]
    
    def assess_prompt_validity(self, user_prompt: str) -> Dict[str, any]:
        """
        Context-aware validation mirroring Cursor's intelligent filtering.
        
        Validation strategy:
        1. Immediately reject clearly irrelevant patterns
        2. Accept prompts containing infrastructure terminology
        3. Accept technical inquiries and discussions
        4. Reject suspiciously brief prompts
        5. Default to acceptance unless clearly off-topic
        
        Returns:
            {
                "valid": bool,
                "reason": str (if invalid),
                "confidence": float (0-1)
            }
        """
        normalized_prompt = user_prompt.lower().strip()
        
        # Phase 1: Filter clearly irrelevant content
        for irrelevant_pattern in self.IRRELEVANT_CONTENT_PATTERNS:
            if re.search(irrelevant_pattern, normalized_prompt):
                return {
                    "valid": False,
                    "reason": "This query appears off-topic. I'm designed for AWS infrastructure and Terraform assistance. Please ask about cloud resources, deployments, or infrastructure configurations.",
                    "confidence": 0.95
                }
        
        # Phase 2: Validate infrastructure terminology presence (ACCEPT)
        contains_infrastructure_terms = any(term in normalized_prompt for term in self.INFRASTRUCTURE_VOCABULARY)
        
        if contains_infrastructure_terms:
            return {
                "valid": True,
                "confidence": 0.95
            }
        
        # Phase 3: Validate technical inquiry patterns
        matches_inquiry_pattern = any(re.search(pattern, normalized_prompt) for pattern in self.TECHNICAL_INQUIRY_PATTERNS)
        
        if matches_inquiry_pattern:
            # Technical question detected - apply permissive acceptance
            # Example: "how should I structure my VPC?" passes even without keywords
            return {
                "valid": True,
                "confidence": 0.75,
                "note": "Technical inquiry/discussion accepted"
            }
        
        # Phase 4: Reject excessively brief prompts
        word_count = len(user_prompt.split())
        if word_count < 3:
            return {
                "valid": False,
                "reason": "Please provide more context. Example: 'create an S3 bucket with versioning' or 'how should I configure my VPC?'",
                "confidence": 0.7
            }
        
        # Phase 5: Default to permissive acceptance (Cursor-style)
        # Reached here: not clearly irrelevant, reasonable length
        return {
            "valid": True,
            "confidence": 0.6,
            "note": "Accepted by default - presumed infrastructure-related"
        }
    
    def validate_or_raise_exception(self, user_prompt: str):
        """
        Validate prompt and raise HTTP exception if invalid.
        Convenient for API endpoint validation.
        """
        validation_result = self.assess_prompt_validity(user_prompt)
        if not validation_result["valid"]:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "invalid_prompt",
                    "message": validation_result["reason"],
                    "hint": "Try something like: 'create an S3 bucket with versioning' or 'deploy a t3.small EC2 instance'"
                }
            )
        return validation_result


# Global intelligent validator singleton
intelligent_prompt_validator = IntelligentPromptValidator()
prompt_validator = intelligent_prompt_validator
