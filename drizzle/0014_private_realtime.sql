-- Private Realtime channels. Apply in the Supabase SQL editor BEFORE deploying
-- the code that uses them: browsers subscribe with { private: true }, and
-- without this policy every subscription is refused (no live updates).
--
-- Until now session:<code> and chat:<code> were public channels: anyone with
-- the anon key and a share code could listen, and send forged events. Private
-- channels are checked against realtime.messages policies instead:
--   * listening (select): a session's active players, or anyone if it is public
--   * sending (insert): no policy, so only the server's service role can
--
-- The check is a SECURITY DEFINER function because the browser roles (anon,
-- authenticated) can't read sessions or session_players themselves (RLS on,
-- no policies). It answers yes/no for one share code and nothing else.

CREATE OR REPLACE FUNCTION public.can_listen_to_session(code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.share_code = code
      AND (
        s.is_public
        OR EXISTS (
          SELECT 1
          FROM public.session_players sp
          WHERE sp.session_id = s.id
            AND sp.player_id = auth.uid()
            AND sp.is_active
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_listen_to_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_listen_to_session(text) TO anon, authenticated;

DROP POLICY IF EXISTS "players and public viewers can listen to sessions" ON realtime.messages;
CREATE POLICY "players and public viewers can listen to sessions"
ON realtime.messages
FOR SELECT
TO anon, authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND split_part(realtime.topic(), ':', 1) IN ('session', 'chat')
  AND public.can_listen_to_session(split_part(realtime.topic(), ':', 2))
);
