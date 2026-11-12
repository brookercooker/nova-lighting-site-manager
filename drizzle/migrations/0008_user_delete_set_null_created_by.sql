ALTER TABLE public.chat_requests ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.chat_requests DROP CONSTRAINT chat_requests_created_by_fkey;
ALTER TABLE public.chat_requests ADD CONSTRAINT chat_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.design_messages ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.design_messages DROP CONSTRAINT design_messages_created_by_fkey;
ALTER TABLE public.design_messages ADD CONSTRAINT design_messages_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;