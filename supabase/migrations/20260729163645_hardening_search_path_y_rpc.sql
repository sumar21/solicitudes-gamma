-- Hardening de las advertencias del linter de seguridad (get_advisors).

-- 1) set_updated_at (nuestra): fijar search_path para evitar search_path injection.
alter function public.set_updated_at() set search_path = '';

-- 2) rls_auto_enable: event trigger PRE-EXISTENTE en el proyecto (auto-activa RLS en cada
--    tabla nueva de public — buena práctica de defensa en profundidad). No está pensado para
--    llamarse por RPC, así que se le saca EXECUTE a anon/authenticated/public. El event trigger
--    sigue funcionando; solo se cierra la exposición vía /rest/v1/rpc.
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
