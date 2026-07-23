-- Allow users to delete their own chat messages so the "Clear chats" button works.
CREATE POLICY "chat delete own"
ON public.chat_messages
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);