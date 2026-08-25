"""
Intelligent interaction mode detection system inspired by Cursor's ask/agent paradigm.
Analyzes user prompts to recommend optimal operational mode.
"""
from typing import Dict, Optional, List
import re


class InteractionModeAnalyzer:
    """
    Analyzes whether a user prompt is better suited for ask or agent mode.
    
    Ask Mode: User seeks explanation, guidance, or discussion
    Agent Mode: User requests task execution and direct action
    """
    
    # Strong indicators suggesting user wants direct action (agent mode)
    EXECUTION_VERBS = [
        'create', 'build', 'implement', 'add', 'make', 'generate',
        'deploy', 'configure', 'setup', 'install', 'fix', 'update',
        'delete', 'remove', 'refactor', 'optimize', 'migrate',
        'provision', 'launch', 'spin up', 'tear down', 'modify'
    ]
    
    # Strong indicators suggesting user wants explanation (ask mode)
    INQUIRY_KEYWORDS = [
        'what', 'why', 'how', 'when', 'where', 'which', 'who',
        'explain', 'describe', 'tell me', 'show me', 'help me understand',
        'can you explain', 'what does', 'how does', 'why does'
    ]
    
    # Phrases indicating discussion/exploration (ask mode)
    EXPLORATORY_INDICATORS = [
        'should i', 'would it be better', 'what if', 'is it possible',
        'do you think', 'recommend', 'suggestion', 'advice', 'opinion',
        'best practice', 'pros and cons', 'compare', 'versus'
    ]
    
    # Phrases indicating urgency/immediate action (agent mode)
    URGENCY_INDICATORS = [
        'need to', 'have to', 'must', 'urgent', 'asap', 'quickly',
        'right now', 'immediately', 'go ahead', 'just do it', 'please do'
    ]
    
    def evaluate_prompt_intent(
        self, 
        user_prompt: str, 
        active_mode: str = "ask",
        dialogue_history: Optional[List[Dict]] = None
    ) -> Optional[Dict]:
        """
        Evaluate if user intent aligns with current operational mode.
        
        Args:
            user_prompt: User's message text
            active_mode: Currently active mode ("ask" or "agent")
            dialogue_history: Previous conversation messages for contextual analysis
        
        Returns:
            {
                "should_suggest_switch": bool,
                "suggested_mode": "ask" | "agent",
                "reason": str,
                "confidence": float (0.0-1.0),
                "message": str (what to display to user)
            }
        """
        normalized_prompt = user_prompt.lower().strip()
        
        # Compute intent classification scores
        action_orientation_score = self._compute_action_intent(normalized_prompt)
        question_orientation_score = self._compute_inquiry_intent(normalized_prompt)
        
        # Check for explicit mode preference in prompt
        explicitly_requested_mode = self._identify_explicit_mode_request(normalized_prompt)
        if explicitly_requested_mode:
            return self._construct_mode_suggestion(
                recommended_mode=explicitly_requested_mode,
                justification="User explicitly requested this mode",
                confidence_level=1.0,
                current_mode=active_mode
            )
        
        # If in ask mode but prompt clearly requests action
        if active_mode == "ask" and action_orientation_score > question_orientation_score + 2:
            calculated_confidence = min(0.95, 0.5 + (action_orientation_score * 0.1))
            
            return self._construct_mode_suggestion(
                recommended_mode="agent",
                justification="This appears to be an executable task",
                confidence_level=calculated_confidence,
                current_mode=active_mode
            )
        
        # If in agent mode but prompt is clearly an inquiry
        if active_mode == "agent" and question_orientation_score > action_orientation_score + 2:
            return self._construct_mode_suggestion(
                recommended_mode="ask",
                justification="This appears to be an inquiry rather than a task",
                confidence_level=0.85,
                current_mode=active_mode
            )
        
        # No strong indication to switch modes
        return None
    
    def _compute_action_intent(self, normalized_prompt: str) -> float:
        """Calculate action-orientation score of the prompt"""
        intent_score = 0.0
        
        # Action verb detection
        for execution_verb in self.EXECUTION_VERBS:
            if re.search(r'\b' + execution_verb + r'\b', normalized_prompt):
                intent_score += 2
        
        # Urgency phrase detection
        for urgency_phrase in self.URGENCY_INDICATORS:
            if urgency_phrase in normalized_prompt:
                intent_score += 3
        
        # Imperative sentence structure (starts with action verb)
        prompt_tokens = normalized_prompt.split()
        if len(prompt_tokens) > 0 and prompt_tokens[0] in self.EXECUTION_VERBS:
            intent_score += 1
        
        # Multi-step task detection (and, then, also)
        if self._contains_multiple_steps(normalized_prompt):
            intent_score += 2
        
        # Exclamation mark indicates action intent
        if normalized_prompt.endswith('!'):
            intent_score += 1
        
        return intent_score
    
    def _compute_inquiry_intent(self, normalized_prompt: str) -> float:
        """Calculate inquiry-orientation score of the prompt"""
        intent_score = 0.0
        
        # Inquiry keyword detection
        for inquiry_word in self.INQUIRY_KEYWORDS:
            if re.search(r'\b' + inquiry_word + r'\b', normalized_prompt):
                intent_score += 2
        
        # Exploratory phrase detection
        for exploratory_phrase in self.EXPLORATORY_INDICATORS:
            if exploratory_phrase in normalized_prompt:
                intent_score += 2
        
        # Question mark indicates inquiry
        if normalized_prompt.endswith('?'):
            intent_score += 3
        
        # Starts with inquiry keyword
        prompt_tokens = normalized_prompt.split()
        if len(prompt_tokens) > 0 and prompt_tokens[0] in self.INQUIRY_KEYWORDS:
            intent_score += 1
        
        return intent_score
    
    def _contains_multiple_steps(self, normalized_prompt: str) -> bool:
        """Detect if prompt describes multiple sequential steps"""
        multi_step_markers = [
            'and then', 'also', 'then', 'after that', 'next',
            'first', 'second', 'third', 'finally', 
            '1.', '2.', '3.', 'step'
        ]
        return any(marker in normalized_prompt for marker in multi_step_markers)
    
    def _identify_explicit_mode_request(self, normalized_prompt: str) -> Optional[str]:
        """Detect if user explicitly requested a specific mode"""
        if any(phrase in normalized_prompt for phrase in ['just do it', 'go ahead', 'please do', 'do it']):
            return "agent"
        
        if any(phrase in normalized_prompt for phrase in ['explain how', 'help me understand', 'what would you do']):
            return "ask"
        
        return None
    
    def _construct_mode_suggestion(
        self,
        recommended_mode: str,
        justification: str,
        confidence_level: float,
        current_mode: str
    ) -> Optional[Dict]:
        """Construct mode switch recommendation"""
        
        # Don't recommend if already in that mode
        if recommended_mode == current_mode:
            return None
        
        # Only recommend if confidence threshold met
        if confidence_level < 0.7:
            return None
        
        # Build user-facing message
        if recommended_mode == "agent":
            display_message = "💡 **Switch to agent mode and I'll execute this immediately**"
            capability_description = "I can perform this task autonomously"
        else:
            display_message = "💡 **Switch to ask mode for comprehensive explanation**"
            capability_description = "I can provide detailed explanation and guidance"
        
        return {
            "should_suggest_switch": True,
            "suggested_mode": recommended_mode,
            "reason": justification,
            "confidence": confidence_level,
            "message": display_message,
            "action_text": capability_description
        }
    
    def get_mode_metadata(self, operational_mode: str) -> Dict[str, str]:
        """Retrieve user-friendly mode description"""
        if operational_mode == "ask":
            return {
                "icon": "🤔",
                "title": "Ask Mode",
                "description": "I'll explain, suggest, and guide you through decisions",
                "behavior": "Demonstrates what I would do without making modifications"
            }
        else:  # agent
            return {
                "icon": "🤖",
                "title": "Agent Mode", 
                "description": "I'll autonomously execute tasks and apply changes",
                "behavior": "Actually modifies files, executes commands, and applies infrastructure changes"
            }


# Global analyzer instance
interaction_mode_analyzer = InteractionModeAnalyzer()
