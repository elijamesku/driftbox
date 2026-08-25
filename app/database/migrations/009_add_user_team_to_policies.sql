-- Add user_id and team_id to policies table for segregation
-- Global policies: user_id IS NULL AND team_id IS NULL (the 8 premade policies)
-- Personal policies: user_id = <user>, team_id IS NULL
-- Team policies: team_id = <team>, user_id can be set (creator)

ALTER TABLE public.policies 
ADD COLUMN IF NOT EXISTS user_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS team_id VARCHAR(36);

-- Set existing policies (the 8 premade) as global if they don't have user_id/team_id
UPDATE public.policies 
SET user_id = NULL, team_id = NULL 
WHERE user_id IS NULL AND team_id IS NULL;

-- Indexes for filtering
CREATE INDEX IF NOT EXISTS idx_policies_user_id ON public.policies(user_id);
CREATE INDEX IF NOT EXISTS idx_policies_team_id ON public.policies(team_id);
