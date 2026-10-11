-- SIE-004: transaction-local trusted identity and tenant context, deny by default otherwise.
CREATE SCHEMA IF NOT EXISTS sie;
CREATE OR REPLACE FUNCTION sie.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('sie.tenant_id',true),'')::uuid
$$;
CREATE OR REPLACE FUNCTION sie.current_identity() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('sie.identity_id',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA sie TO PUBLIC;
-- Membership is only visible to the active principal in the requested tenant.
CREATE POLICY memberships_self_read ON memberships FOR SELECT
 USING (tenant_id=sie.current_tenant() AND identity_id=sie.current_identity());
CREATE POLICY identities_self_read ON identities FOR SELECT
 USING (id=sie.current_identity());
CREATE POLICY tenants_member_read ON tenants FOR SELECT
 USING (id=sie.current_tenant() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=tenants.id AND m.identity_id=sie.current_identity()));
CREATE POLICY projects_member_read ON projects FOR SELECT
 USING (tenant_id=sie.current_tenant() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=projects.tenant_id AND m.identity_id=sie.current_identity()));
CREATE POLICY projects_member_insert ON projects FOR INSERT
 WITH CHECK (tenant_id=sie.current_tenant() AND owner_id=sie.current_identity() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=projects.tenant_id AND m.identity_id=sie.current_identity() AND m.role IN ('owner','admin','member')));
CREATE POLICY projects_member_update ON projects FOR UPDATE
 USING (tenant_id=sie.current_tenant() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=projects.tenant_id AND m.identity_id=sie.current_identity() AND m.role IN ('owner','admin','member')))
 WITH CHECK (tenant_id=sie.current_tenant() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=projects.tenant_id AND m.identity_id=sie.current_identity() AND m.role IN ('owner','admin','member')));
CREATE POLICY projects_admin_delete ON projects FOR DELETE
 USING (tenant_id=sie.current_tenant() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=projects.tenant_id AND m.identity_id=sie.current_identity() AND m.role IN ('owner','admin')));
CREATE POLICY assets_member_read ON asset_metadata FOR SELECT
 USING (tenant_id=sie.current_tenant() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=asset_metadata.tenant_id AND m.identity_id=sie.current_identity()));
CREATE POLICY assets_member_write ON asset_metadata FOR INSERT
 WITH CHECK (tenant_id=sie.current_tenant() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=asset_metadata.tenant_id AND m.identity_id=sie.current_identity() AND m.role IN ('owner','admin','member')));
CREATE POLICY assets_member_delete ON asset_metadata FOR DELETE
 USING (tenant_id=sie.current_tenant() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=asset_metadata.tenant_id AND m.identity_id=sie.current_identity() AND m.role IN ('owner','admin','member')));
CREATE POLICY budget_account_member_read ON budget_accounts FOR SELECT
 USING (tenant_id=sie.current_tenant() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=budget_accounts.tenant_id AND m.identity_id=sie.current_identity()));
CREATE POLICY budget_reservation_member_read ON budget_reservations FOR SELECT
 USING (tenant_id=sie.current_tenant() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=budget_reservations.tenant_id AND m.identity_id=sie.current_identity()));
CREATE POLICY budget_event_member_read ON budget_events FOR SELECT
 USING (tenant_id=sie.current_tenant() AND EXISTS
   (SELECT 1 FROM memberships m WHERE m.tenant_id=budget_events.tenant_id AND m.identity_id=sie.current_identity()));
-- Writes to memberships, identities and budget entries remain restricted to separate privileged brokers.
-- Never grant UPDATE to project.owner_id or tenant_id for a normal app principal.
