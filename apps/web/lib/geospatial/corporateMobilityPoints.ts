import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@fleet/supabase-client";

/**
 * Phase C2 — Corporate Mobility Points CRUD service.
 *
 * Uses the caller-supplied, RLS-respecting Supabase server client (never the admin/service
 * role client) — `corporate_mobility_points`'s own RLS policies
 * (0054_corporate_mobility_points_and_geo_quota.sql) already scope reads to the caller's
 * organization and writes to fleet_manager/administrator, so this service is a thin,
 * typed wrapper, not a place that re-implements authorization.
 */

export interface CorporateMobilityPoint {
  id: string;
  organizationId: string;
  name: string;
  aliases: string[];
  addressLabel: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
  category: string | null;
  providerPlaceRef: string | null;
}

type Row = Database["public"]["Tables"]["corporate_mobility_points"]["Row"];

function toDomain(row: Row): CorporateMobilityPoint {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    aliases: row.aliases,
    addressLabel: row.address_label,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    isActive: row.is_active,
    category: row.category,
    providerPlaceRef: row.provider_place_ref,
  };
}

export type CmpServiceResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

export async function listCorporateMobilityPoints(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<CmpServiceResult<CorporateMobilityPoint[]>> {
  let query = supabase
    .from("corporate_mobility_points")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name");

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) return { status: "error", message: error.message };
  return { status: "ok", data: (data ?? []).map(toDomain) };
}

export interface CreateCorporateMobilityPointInput {
  organizationId: string;
  name: string;
  aliases?: string[];
  addressLabel: string;
  latitude: number;
  longitude: number;
  category?: string | null;
  providerPlaceRef?: string | null;
}

export async function createCorporateMobilityPoint(
  supabase: SupabaseClient<Database>,
  input: CreateCorporateMobilityPointInput,
): Promise<CmpServiceResult<CorporateMobilityPoint>> {
  if (!input.name.trim() || !input.addressLabel.trim()) {
    return { status: "error", message: "invalid_values" };
  }
  if (
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    input.longitude < -180 ||
    input.longitude > 180
  ) {
    return { status: "error", message: "invalid_coordinates" };
  }

  const { data, error } = await supabase
    .from("corporate_mobility_points")
    .insert({
      organization_id: input.organizationId,
      name: input.name.trim(),
      aliases: input.aliases ?? [],
      address_label: input.addressLabel.trim(),
      latitude: input.latitude,
      longitude: input.longitude,
      category: input.category ?? null,
      provider_place_ref: input.providerPlaceRef ?? null,
    })
    .select("*")
    .single();

  if (error) return { status: "error", message: error.message };
  return { status: "ok", data: toDomain(data) };
}

export interface UpdateCorporateMobilityPointInput {
  id: string;
  name?: string;
  aliases?: string[];
  addressLabel?: string;
  latitude?: number;
  longitude?: number;
  category?: string | null;
}

export async function updateCorporateMobilityPoint(
  supabase: SupabaseClient<Database>,
  input: UpdateCorporateMobilityPointInput,
): Promise<CmpServiceResult<CorporateMobilityPoint>> {
  const patch: Database["public"]["Tables"]["corporate_mobility_points"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) {
    if (!input.name.trim()) return { status: "error", message: "invalid_values" };
    patch.name = input.name.trim();
  }
  if (input.aliases !== undefined) patch.aliases = input.aliases;
  if (input.addressLabel !== undefined) {
    if (!input.addressLabel.trim()) return { status: "error", message: "invalid_values" };
    patch.address_label = input.addressLabel.trim();
  }
  if (input.latitude !== undefined) {
    if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
      return { status: "error", message: "invalid_coordinates" };
    }
    patch.latitude = input.latitude;
  }
  if (input.longitude !== undefined) {
    if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
      return { status: "error", message: "invalid_coordinates" };
    }
    patch.longitude = input.longitude;
  }
  if (input.category !== undefined) patch.category = input.category;

  const { data, error } = await supabase
    .from("corporate_mobility_points")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) return { status: "error", message: error.message };
  return { status: "ok", data: toDomain(data) };
}

export async function deactivateCorporateMobilityPoint(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<CmpServiceResult<true>> {
  const { error } = await supabase
    .from("corporate_mobility_points")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { status: "error", message: error.message };
  return { status: "ok", data: true };
}
