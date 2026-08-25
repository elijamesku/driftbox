"""
LLM Failover Service - Automatically switches to OpenAI GPT-4 when Claude fails.
Handles overload errors and rate limits gracefully.
"""
import os
import json
import asyncio
from typing import AsyncGenerator, Optional, Dict, Any, List
from anthropic import Anthropic, APIStatusError, RateLimitError
from openai import OpenAI, APIError, RateLimitError as OpenAIRateLimitError


class LLMFailoverService:
    """
    Manages failover between Claude and OpenAI for chat completions.
    Automatically detects Claude API failures and falls back to OpenAI GPT-4.
    """
    
    def __init__(self):
        """Initialize both Claude and OpenAI clients."""
        # Initialize Claude
        self._anthropic_instance = None
        if os.getenv("ANTHROPIC_API_KEY"):
            try:
                self._anthropic_instance = Anthropic(
                    api_key=os.environ["ANTHROPIC_API_KEY"],
                    timeout=300.0  # 5 minutes for complex queries
                )
            except Exception as e:
                print(f"⚠️  Failed to initialize Claude: {e}")
        
        # Initialize OpenAI
        self._openai_instance = None
        if os.getenv("OPENAI_API_KEY"):
            try:
                self._openai_instance = OpenAI(
                    api_key=os.environ["OPENAI_API_KEY"],
                    timeout=300.0
                )
            except Exception as e:
                print(f"⚠️  Failed to initialize OpenAI: {e}")
        
        # Track which provider is currently being used
        self._current_provider = "claude"
        self._failover_active = False
    
    def _is_claude_overload_error(self, error: Exception) -> bool:
        """
        Check if the error is a Claude overload error.
        Returns True if we should failover to OpenAI.
        """
        error_str = str(error).lower()
        error_types = [
            "overloaded",
            "overload",
            "rate limit",
            "rate_limit",
            "too many requests",
            "429",
            "503",
            "capacity",
            "server_error"
        ]
        
        # Check if it's an API status error with overload
        if isinstance(error, (APIStatusError, RateLimitError)):
            return True
        
        # Check error message
        return any(err_type in error_str for err_type in error_types)
    
    def _convert_claude_messages_to_openai(self, messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
        """
        Convert Claude message format to OpenAI format.
        Both use the same format, but this allows for future compatibility.
        """
        return messages
    
    async def stream_chat_completion(
        self,
        messages: List[Dict[str, str]],
        system_prompt: str,
        model: str = "claude-sonnet-4-20250514",
        max_tokens: int = 2048,
        temperature: float = 0.7,
        force_provider: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """
        Stream chat completion with automatic failover.
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            system_prompt: System prompt for the model
            model: Claude model name (will be mapped to GPT-4 if failover)
            max_tokens: Maximum tokens to generate
            temperature: Temperature for generation
            force_provider: Force a specific provider ('claude' or 'openai')
        
        Yields:
            Text tokens from the model
        """
        # CRITICAL: If user explicitly chose OpenAI, ONLY try OpenAI (no Claude fallback)
        if force_provider == "openai":
            if not self._openai_instance:
                raise Exception("OpenAI provider requested but OPENAI_API_KEY not configured")
            
            openai_model = self._map_claude_to_openai_model(model)
            print(f"🤖 [LLM Failover] User selected OpenAI: {openai_model}")
            
            # Convert messages to OpenAI format
            openai_messages = self._convert_claude_messages_to_openai(messages)
            
            # Add system prompt as first message
            full_messages = [{"role": "system", "content": system_prompt}] + openai_messages
            
            # Stream from OpenAI
            response = self._openai_instance.chat.completions.create(
                model=openai_model,
                messages=full_messages,
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True
            )
            
            for chunk in response:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
            
            return
        
        # CRITICAL: If user explicitly chose Claude, ONLY try Claude (no OpenAI fallback)
        if force_provider == "claude":
            if not self._anthropic_instance:
                raise Exception("Claude provider requested but ANTHROPIC_API_KEY not configured")
            
            print(f"🤖 [LLM Failover] User selected Claude: {model}")
            
            with self._anthropic_instance.messages.stream(
                model=model,
                max_tokens=max_tokens,
                system=system_prompt,
                messages=messages,
                temperature=temperature
            ) as stream:
                for text in stream.text_stream:
                    yield text
            
            return
        
        # No explicit provider - use automatic failover (try Claude, then OpenAI)
        # Try Claude first
        if self._anthropic_instance:
            try:
                print(f"🤖 [LLM Failover] Auto mode: Trying Claude: {model}")
                
                with self._anthropic_instance.messages.stream(
                    model=model,
                    max_tokens=max_tokens,
                    system=system_prompt,
                    messages=messages,
                    temperature=temperature
                ) as stream:
                    for text in stream.text_stream:
                        yield text
                        await asyncio.sleep(0)
                
                # Success! Reset failover flag
                self._failover_active = False
                return
                
            except Exception as e:
                if self._is_claude_overload_error(e):
                    print(f"⚠️  [LLM Failover] Claude overloaded: {str(e)[:100]}")
                    print(f"🔄 [LLM Failover] Switching to OpenAI GPT-4...")
                    self._failover_active = True
                    # Fall through to OpenAI
                else:
                    # Other error - raise it
                    raise
        
        # Fallback to OpenAI (if Claude failed OR Claude not configured)
        if self._openai_instance:
            # Map Claude model to OpenAI model
            openai_model = self._map_claude_to_openai_model(model)
            print(f"🤖 [LLM Failover] Using OpenAI: {openai_model}")
            
            # Convert messages to OpenAI format
            openai_messages = self._convert_claude_messages_to_openai(messages)
            
            # Add system prompt as first message
            full_messages = [{"role": "system", "content": system_prompt}] + openai_messages
            
            # Stream from OpenAI
            response = self._openai_instance.chat.completions.create(
                model=openai_model,
                messages=full_messages,
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True
            )
            
            for chunk in response:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
            
            return
        
        # No provider available
        raise Exception("No LLM provider available. Please configure ANTHROPIC_API_KEY or OPENAI_API_KEY.")
    
    def _map_claude_to_openai_model(self, claude_model: str) -> str:
        """
        Map Claude model names to equivalent OpenAI models.
        """
        # For Sonnet 4 (latest Claude), use GPT-4 Turbo
        if "sonnet" in claude_model.lower() or "claude-3" in claude_model.lower():
            return "gpt-4-turbo-preview"
        
        # Default to GPT-4 Turbo
        return os.getenv("OPENAI_MODEL", "gpt-4-turbo-preview")
    
    async def create_completion(
        self,
        messages: List[Dict[str, str]],
        system_prompt: str,
        model: str = "claude-sonnet-4-20250514",
        max_tokens: int = 2048,
        temperature: float = 0.7,
        force_provider: Optional[str] = None
    ) -> str:
        """
        Non-streaming completion with automatic failover.
        
        Returns:
            Complete text response from the model
        """
        full_response = ""
        async for token in self.stream_chat_completion(
            messages=messages,
            system_prompt=system_prompt,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            force_provider=force_provider
        ):
            full_response += token
        
        return full_response
    
    def get_current_provider(self) -> str:
        """Get the current active provider."""
        return "openai" if self._failover_active else "claude"
    
    def is_failover_active(self) -> bool:
        """Check if failover mode is currently active."""
        return self._failover_active
    
    def reset_failover(self):
        """Reset failover state to try Claude again."""
        self._failover_active = False
        self._current_provider = "claude"


# Global singleton instance
llm_failover_service = LLMFailoverService()

