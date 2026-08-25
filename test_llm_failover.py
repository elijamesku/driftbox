"""
Test script for LLM Failover functionality.
Tests Claude -> OpenAI failover when Claude API is overloaded.
"""
import asyncio
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.llm_failover import llm_failover_service


async def test_ask_mode_failover():
    """Test Ask Mode streaming with failover"""
    print("\n" + "=" * 60)
    print("TEST 1: Ask Mode - Infrastructure Question")
    print("=" * 60)
    
    prompt = "What is an S3 bucket and when should I use it?"
    system_prompt = """You are an expert DevOps engineer. Explain infrastructure concepts clearly."""
    
    print(f"Prompt: {prompt}")
    print(f"Current Provider: {llm_failover_service.get_current_provider()}")
    print("\nStreaming response:")
    print("-" * 60)
    
    try:
        response = ""
        async for token in llm_failover_service.stream_chat_completion(
            messages=[{"role": "user", "content": prompt}],
            system_prompt=system_prompt,
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            temperature=0.7
        ):
            response += token
            print(token, end="", flush=True)
        
        print("\n" + "-" * 60)
        print(f"✅ Response length: {len(response)} chars")
        print(f"Final Provider: {llm_failover_service.get_current_provider()}")
        print(f"Failover Active: {llm_failover_service.is_failover_active()}")
        
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        return False
    
    return True


async def test_agent_mode_failover():
    """Test Agent Mode (Terraform generation) with failover"""
    print("\n" + "=" * 60)
    print("TEST 2: Agent Mode - Terraform Generation")
    print("=" * 60)
    
    prompt = "Create an S3 bucket named test-logs-bucket with versioning enabled"
    system_prompt = """Terraform IR generator. Output ONLY JSON with ops array."""
    
    print(f"Prompt: {prompt}")
    print(f"Current Provider: {llm_failover_service.get_current_provider()}")
    print("\nStreaming response:")
    print("-" * 60)
    
    try:
        response = ""
        async for token in llm_failover_service.stream_chat_completion(
            messages=[{"role": "user", "content": prompt}],
            system_prompt=system_prompt,
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            temperature=0
        ):
            response += token
            print(token, end="", flush=True)
        
        print("\n" + "-" * 60)
        print(f"✅ Response length: {len(response)} chars")
        print(f"Final Provider: {llm_failover_service.get_current_provider()}")
        print(f"Failover Active: {llm_failover_service.is_failover_active()}")
        
        # Check if response looks like JSON
        if response.strip().startswith("{"):
            print("✅ Response appears to be valid JSON format")
        else:
            print("⚠️  Response doesn't look like JSON (might need parsing)")
        
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        return False
    
    return True


async def test_forced_openai():
    """Test forcing OpenAI provider directly"""
    print("\n" + "=" * 60)
    print("TEST 3: Forced OpenAI Provider")
    print("=" * 60)
    
    prompt = "Explain what Terraform is in one sentence."
    system_prompt = """You are a DevOps engineer. Be concise."""
    
    print(f"Prompt: {prompt}")
    print("Forcing OpenAI provider...")
    print("\nStreaming response:")
    print("-" * 60)
    
    try:
        response = ""
        async for token in llm_failover_service.stream_chat_completion(
            messages=[{"role": "user", "content": prompt}],
            system_prompt=system_prompt,
            model="claude-sonnet-4-20250514",  # Will be mapped to GPT-4
            max_tokens=200,
            temperature=0.5,
            force_provider="openai"
        ):
            response += token
            print(token, end="", flush=True)
        
        print("\n" + "-" * 60)
        print(f"✅ Response length: {len(response)} chars")
        print(f"Provider used: OpenAI (forced)")
        
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        return False
    
    return True


async def test_error_handling():
    """Test error handling when both providers fail"""
    print("\n" + "=" * 60)
    print("TEST 4: Error Handling (Invalid API Keys)")
    print("=" * 60)
    
    # Temporarily unset API keys to test error handling
    original_claude_key = os.environ.get("ANTHROPIC_API_KEY")
    original_openai_key = os.environ.get("OPENAI_API_KEY")
    
    print("Testing error handling with invalid credentials...")
    
    # Reinitialize service with no keys
    os.environ["ANTHROPIC_API_KEY"] = "invalid"
    os.environ["OPENAI_API_KEY"] = "invalid"
    
    # Create new service instance
    from app.services.llm_failover import LLMFailoverService
    test_service = LLMFailoverService()
    
    try:
        response = ""
        async for token in test_service.stream_chat_completion(
            messages=[{"role": "user", "content": "test"}],
            system_prompt="test",
            model="claude-sonnet-4-20250514",
            max_tokens=10
        ):
            response += token
        
        print("⚠️  No error raised (unexpected)")
        success = False
    except Exception as e:
        print(f"✅ Error correctly raised: {str(e)[:100]}...")
        success = True
    finally:
        # Restore original keys
        if original_claude_key:
            os.environ["ANTHROPIC_API_KEY"] = original_claude_key
        if original_openai_key:
            os.environ["OPENAI_API_KEY"] = original_openai_key
    
    return success


async def main():
    """Run all failover tests"""
    print("\n")
    print("=" * 60)
    print(" LLM FAILOVER SERVICE - TEST SUITE")
    print("=" * 60)
    
    # Check API keys
    has_claude = bool(os.getenv("ANTHROPIC_API_KEY"))
    has_openai = bool(os.getenv("OPENAI_API_KEY"))
    
    print(f"\n✅ Claude API Key: {'Present' if has_claude else '❌ Missing'}")
    print(f"{'✅' if has_openai else '❌'} OpenAI API Key: {'Present' if has_openai else '❌ Missing'}")
    
    if not has_claude and not has_openai:
        print("\n❌ ERROR: No API keys found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY")
        return
    
    if not has_openai:
        print("\n⚠️  WARNING: OpenAI API key missing. Failover will not work!")
        print("Set OPENAI_API_KEY environment variable to test failover.")
    
    # Run tests
    results = []
    
    # Test 1: Ask mode
    if has_claude or has_openai:
        results.append(("Ask Mode", await test_ask_mode_failover()))
    
    # Test 2: Agent mode
    if has_claude or has_openai:
        results.append(("Agent Mode", await test_agent_mode_failover()))
    
    # Test 3: Forced OpenAI
    if has_openai:
        results.append(("Forced OpenAI", await test_forced_openai()))
    else:
        print("\n⏭️  Skipping Forced OpenAI test (no API key)")
    
    # Test 4: Error handling
    results.append(("Error Handling", await test_error_handling()))
    
    # Summary
    print("\n" + "=" * 60)
    print(" TEST SUMMARY")
    print("=" * 60)
    for test_name, success in results:
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    total = len(results)
    passed = sum(1 for _, success in results if success)
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed!")
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")


if __name__ == "__main__":
    asyncio.run(main())

