"""
Conversation thread manager for auditable infrastructure change lineage.
Tracks conversation threads, links them to git commits, and provides chat-like interface.
"""
from typing import Optional, Dict, Any, List
from datetime import datetime
from app.database.connection import primary_session_context
from app.database.models import ConversationThread, ChatMessage


class InfrastructureConversationManager:
    """Manages infrastructure conversation threads with complete git commit lineage"""
    
    def initialize_conversation_thread(
        self,
        thread_title: str,
        account_id: Optional[str] = None,
        repository_location: Optional[str] = None,
    ) -> str:
        """
        Create a new conversation thread for infrastructure discussions.
        
        Returns:
            thread_identifier: UUID of created conversation thread
        """
        with primary_session_context() as db_session:
            new_thread = ConversationThread(
                title=thread_title,
                user_id=account_id,
                repository_path=repository_location,
            )
            db_session.add(new_thread)
            db_session.commit()
            db_session.refresh(new_thread)
            
            return new_thread.id
    
    def append_message_to_thread(
        self,
        thread_identifier: str,
        message_role: str,
        message_content: str,
        infrastructure_changes: Optional[Dict[str, Any]] = None,
        associated_diff_id: Optional[str] = None,
        git_commit_hash: Optional[str] = None,
        git_branch_name: Optional[str] = None,
        pull_request_url: Optional[str] = None,
        ai_reasoning_data: Optional[Dict[str, Any]] = None,
        cost_impact_analysis: Optional[Dict[str, Any]] = None,
        modified_file_list: Optional[List[str]] = None,
    ) -> str:
        """
        Append a message to an existing conversation thread.
        
        Args:
            thread_identifier: Parent conversation thread ID
            message_role: 'user' or 'assistant'
            message_content: Message text content
            infrastructure_changes: Infrastructure modifications (for assistant messages)
            associated_diff_id: Link to diff session
            git_commit_hash: Git commit SHA this message resulted in
            git_branch_name: Git branch created
            pull_request_url: Pull request URL
            ai_reasoning_data: AI reasoning for infrastructure changes
            cost_impact_analysis: Cost analysis data
            modified_file_list: List of modified files
        
        Returns:
            message_identifier: UUID of created message
        """
        with primary_session_context() as db_session:
            new_message = ChatMessage(
                conversation_id=thread_identifier,
                role=message_role,
                content=message_content,
                ir=infrastructure_changes,
                diff_id=associated_diff_id,
                commit_sha=git_commit_hash,
                branch_name=git_branch_name,
                pr_url=pull_request_url,
                reasoning=ai_reasoning_data,
                cost_impact=cost_impact_analysis,
                files_changed=modified_file_list,
            )
            db_session.add(new_message)
            
            # Update conversation thread timestamp
            conversation_thread = db_session.query(ConversationThread).filter(ConversationThread.id == thread_identifier).first()
            if conversation_thread:
                conversation_thread.updated_at = datetime.utcnow()
            
            db_session.commit()
            db_session.refresh(new_message)
            
            return new_message.id
    
    def retrieve_conversation_thread(self, thread_identifier: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Retrieve complete conversation thread with all messages.
        
        Args:
            thread_identifier: Conversation thread ID
            user_id: Optional user ID to verify ownership (security check)
        
        Returns:
            Conversation dict if found and user_id matches (if provided), None otherwise
        """
        with primary_session_context() as db_session:
            query = db_session.query(ConversationThread).filter(ConversationThread.id == thread_identifier)
            
            # Security: If user_id provided, verify ownership
            if user_id:
                query = query.filter(ConversationThread.user_id == user_id)
            
            conversation_thread = query.first()
            if not conversation_thread:
                return None
            
            thread_messages = db_session.query(ChatMessage).filter(
                ChatMessage.conversation_id == thread_identifier
            ).order_by(ChatMessage.created_at.asc()).all()
            
            return {
                "id": conversation_thread.id,
                "title": conversation_thread.title,
                "user_id": conversation_thread.user_id,
                "repository_path": conversation_thread.repository_path,
                "created_at": conversation_thread.created_at.isoformat() if conversation_thread.created_at else None,
                "updated_at": conversation_thread.updated_at.isoformat() if conversation_thread.updated_at else None,
                "messages": [self._convert_message_to_dict(msg) for msg in thread_messages],
                "message_count": len(thread_messages),
            }
    
    def retrieve_conversation_with_git_lineage(self, thread_identifier: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Retrieve conversation thread with complete git commit lineage.
        Demonstrates how infrastructure evolved through the conversation.
        
        Args:
            thread_identifier: Conversation thread ID
            user_id: Optional user ID to verify ownership (security check)
        """
        conversation_data = self.retrieve_conversation_thread(thread_identifier, user_id=user_id)
        if not conversation_data:
            return None
        
        # Extract git commit lineage from messages
        infrastructure_lineage = []
        for message in conversation_data["messages"]:
            if message.get("commit_sha"):
                infrastructure_lineage.append({
                    "timestamp": message["created_at"],
                    "user_prompt": self._locate_previous_user_message(conversation_data["messages"], message),
                    "commit_sha": message["commit_sha"],
                    "branch": message.get("branch_name"),
                    "pr_url": message.get("pr_url"),
                    "files_changed": message.get("files_changed", []),
                    "cost_impact": message.get("cost_impact"),
                })
        
        conversation_data["lineage"] = infrastructure_lineage
        return conversation_data
    
    def enumerate_conversation_threads(
        self,
        account_id: Optional[str] = None,
        result_limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Enumerate recent conversation threads"""
        with primary_session_context() as db_session:
            query_builder = db_session.query(ConversationThread).order_by(ConversationThread.updated_at.desc())
            
            if account_id:
                query_builder = query_builder.filter(ConversationThread.user_id == account_id)
            
            conversation_threads = query_builder.limit(result_limit).all()
            
            thread_summaries = []
            for thread in conversation_threads:
                message_count = db_session.query(ChatMessage).filter(ChatMessage.conversation_id == thread.id).count()
                thread_summaries.append({
                    "id": thread.id,
                    "title": thread.title,
                    "user_id": thread.user_id,
                    "message_count": message_count,
                    "created_at": thread.created_at.isoformat() if thread.created_at else None,
                    "updated_at": thread.updated_at.isoformat() if thread.updated_at else None,
                })
            
            return thread_summaries
    
    def search_conversation_threads(self, search_query: str, account_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Search conversation threads by message content"""
        with primary_session_context() as db_session:
            # Search within messages
            query_builder = db_session.query(ChatMessage).filter(ChatMessage.content.ilike(f"%{search_query}%"))
            
            if account_id:
                query_builder = query_builder.join(ConversationThread).filter(ConversationThread.user_id == account_id)
            
            matching_messages = query_builder.all()
            
            # Extract unique conversation thread IDs
            unique_thread_ids = list(set(msg.conversation_id for msg in matching_messages))
            
            matching_threads = db_session.query(ConversationThread).filter(
                ConversationThread.id.in_(unique_thread_ids)
            ).all()
            
            return [{
                "id": thread.id,
                "title": thread.title,
                "user_id": thread.user_id,
                "created_at": thread.created_at.isoformat() if thread.created_at else None,
            } for thread in matching_threads]
    
    def remove_conversation_thread(self, thread_identifier: str) -> bool:
        """Delete conversation thread and all associated messages"""
        with primary_session_context() as db_session:
            conversation_thread = db_session.query(ConversationThread).filter(ConversationThread.id == thread_identifier).first()
            if conversation_thread:
                db_session.delete(conversation_thread)
                db_session.commit()
                return True
            return False
    
    def _convert_message_to_dict(self, message: ChatMessage) -> Dict[str, Any]:
        """Convert ChatMessage model to dictionary representation"""
        return {
            "id": message.id,
            "role": message.role,
            "content": message.content,
            "ir": message.ir,
            "diff_id": message.diff_id,
            "commit_sha": message.commit_sha,
            "branch_name": message.branch_name,
            "pr_url": message.pr_url,
            "reasoning": message.reasoning,
            "cost_impact": message.cost_impact,
            "files_changed": message.files_changed,
            "created_at": message.created_at.isoformat() if message.created_at else None,
        }
    
    def _locate_previous_user_message(self, message_list: List[Dict], current_message: Dict) -> Optional[str]:
        """Locate the user prompt that preceded this assistant response"""
        current_message_idx = next((idx for idx, msg in enumerate(message_list) if msg["id"] == current_message["id"]), None)
        if current_message_idx is None:
            return None
        
        # Search backwards for preceding user message
        for idx in range(current_message_idx - 1, -1, -1):
            if message_list[idx]["role"] == "user":
                return message_list[idx]["content"]
        
        return None


# Global conversation manager instance
infrastructure_conversation_manager = InfrastructureConversationManager()
conversation_manager = infrastructure_conversation_manager

