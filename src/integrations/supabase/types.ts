export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          detail: Json | null
          id: string
          target_email: string | null
          target_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          target_email?: string | null
          target_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          target_email?: string | null
          target_id?: string | null
        }
        Relationships: []
      }
      admin_emails: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      chat_requests: {
        Row: {
          claude_notes: string | null
          created_at: string
          created_by: string | null
          draft_branch: string | null
          draft_commit_sha: string | null
          error_message: string | null
          fidelity_notes: string | null
          id: string
          lovable_commit_sha: string | null
          preview_url: string | null
          prompt: string
          status: string
          updated_at: string
        }
        Insert: {
          claude_notes?: string | null
          created_at?: string
          created_by?: string | null
          draft_branch?: string | null
          draft_commit_sha?: string | null
          error_message?: string | null
          fidelity_notes?: string | null
          id?: string
          lovable_commit_sha?: string | null
          preview_url?: string | null
          prompt: string
          status?: string
          updated_at?: string
        }
        Update: {
          claude_notes?: string | null
          created_at?: string
          created_by?: string | null
          draft_branch?: string | null
          draft_commit_sha?: string | null
          error_message?: string | null
          fidelity_notes?: string | null
          id?: string
          lovable_commit_sha?: string | null
          preview_url?: string | null
          prompt?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      collection_mappings: {
        Row: {
          created_at: string
          id: string
          leaf_slug: string
          leaf_title: string
          parent_category: string | null
          shopify_collection_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          leaf_slug: string
          leaf_title: string
          parent_category?: string | null
          shopify_collection_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          leaf_slug?: string
          leaf_title?: string
          parent_category?: string | null
          shopify_collection_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      design_messages: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          relayed_at: string | null
          sender: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          relayed_at?: string | null
          sender: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          relayed_at?: string | null
          sender?: string
        }
        Relationships: []
      }
      image_page_usages: {
        Row: {
          created_at: string
          image_id: string
          page_id: string
        }
        Insert: {
          created_at?: string
          image_id: string
          page_id: string
        }
        Update: {
          created_at?: string
          image_id?: string
          page_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_page_usages_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_page_usages_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      images: {
        Row: {
          alt_text: string | null
          archived_at: string | null
          camera: string | null
          created_at: string
          description: string | null
          exif_extracted_at: string | null
          fallback_bytes: number | null
          fallback_path: string | null
          fallback_url: string | null
          filename: string
          gps_lat: number | null
          gps_lng: number | null
          height: number | null
          id: string
          lens: string | null
          original_bytes: number | null
          original_path: string
          original_url: string
          place_details: Json | null
          place_name: string | null
          slug_id: string
          tags: string[]
          taken_at: string | null
          updated_at: string
          visibility: string
          web_bytes: number | null
          web_path: string
          web_url: string
          width: number | null
        }
        Insert: {
          alt_text?: string | null
          archived_at?: string | null
          camera?: string | null
          created_at?: string
          description?: string | null
          exif_extracted_at?: string | null
          fallback_bytes?: number | null
          fallback_path?: string | null
          fallback_url?: string | null
          filename: string
          gps_lat?: number | null
          gps_lng?: number | null
          height?: number | null
          id?: string
          lens?: string | null
          original_bytes?: number | null
          original_path: string
          original_url: string
          place_details?: Json | null
          place_name?: string | null
          slug_id: string
          tags?: string[]
          taken_at?: string | null
          updated_at?: string
          visibility?: string
          web_bytes?: number | null
          web_path: string
          web_url: string
          width?: number | null
        }
        Update: {
          alt_text?: string | null
          archived_at?: string | null
          camera?: string | null
          created_at?: string
          description?: string | null
          exif_extracted_at?: string | null
          fallback_bytes?: number | null
          fallback_path?: string | null
          fallback_url?: string | null
          filename?: string
          gps_lat?: number | null
          gps_lng?: number | null
          height?: number | null
          id?: string
          lens?: string | null
          original_bytes?: number | null
          original_path?: string
          original_url?: string
          place_details?: Json | null
          place_name?: string | null
          slug_id?: string
          tags?: string[]
          taken_at?: string | null
          updated_at?: string
          visibility?: string
          web_bytes?: number | null
          web_path?: string
          web_url?: string
          width?: number | null
        }
        Relationships: []
      }
      link_audit_meta: {
        Row: {
          id: number
          last_ran_at: string | null
          scanned_pages: string[]
          summary: Json
          updated_at: string
        }
        Insert: {
          id?: number
          last_ran_at?: string | null
          scanned_pages?: string[]
          summary?: Json
          updated_at?: string
        }
        Update: {
          id?: number
          last_ran_at?: string | null
          scanned_pages?: string[]
          summary?: Json
          updated_at?: string
        }
        Relationships: []
      }
      link_audit_rows: {
        Row: {
          destination: string
          dismissed: boolean
          first_seen_at: string
          id: string
          identity_key: string
          is_chrome: boolean
          is_deleted: boolean
          last_seen_at: string
          link_text: string
          location: string
          source_pages: string[]
          status: string
          tags: string[]
          type: string
          updated_at: string
        }
        Insert: {
          destination?: string
          dismissed?: boolean
          first_seen_at?: string
          id?: string
          identity_key: string
          is_chrome?: boolean
          is_deleted?: boolean
          last_seen_at?: string
          link_text: string
          location: string
          source_pages?: string[]
          status: string
          tags?: string[]
          type: string
          updated_at?: string
        }
        Update: {
          destination?: string
          dismissed?: boolean
          first_seen_at?: string
          id?: string
          identity_key?: string
          is_chrome?: boolean
          is_deleted?: boolean
          last_seen_at?: string
          link_text?: string
          location?: string
          source_pages?: string[]
          status?: string
          tags?: string[]
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      object_page_usages: {
        Row: {
          created_at: string
          object_registry_id: string
          page_id: string
        }
        Insert: {
          created_at?: string
          object_registry_id: string
          page_id: string
        }
        Update: {
          created_at?: string
          object_registry_id?: string
          page_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "object_page_usages_object_registry_id_fkey"
            columns: ["object_registry_id"]
            isOneToOne: false
            referencedRelation: "object_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "object_page_usages_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      object_registry: {
        Row: {
          archived_at: string | null
          component_key: string | null
          content: Json | null
          created_at: string
          description: string | null
          id: string
          inline_edits: Json
          intended_pages: string[]
          labels: string[]
          name: string
          preview_url: string | null
          site_wide: boolean
          slug_id: string | null
          status: string
          thumbnail_build_version: string | null
          thumbnail_updated_at: string | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          component_key?: string | null
          content?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          inline_edits?: Json
          intended_pages?: string[]
          labels?: string[]
          name: string
          preview_url?: string | null
          site_wide?: boolean
          slug_id?: string | null
          status?: string
          thumbnail_build_version?: string | null
          thumbnail_updated_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          component_key?: string | null
          content?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          inline_edits?: Json
          intended_pages?: string[]
          labels?: string[]
          name?: string
          preview_url?: string | null
          site_wide?: boolean
          slug_id?: string | null
          status?: string
          thumbnail_build_version?: string | null
          thumbnail_updated_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          content: Json | null
          created_at: string
          description: string | null
          id: string
          name: string
          notes: string | null
          slug_id: string
          status: Database["public"]["Enums"]["object_status"]
          tags: string[]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          content?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          slug_id: string
          status?: Database["public"]["Enums"]["object_status"]
          tags?: string[]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          content?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          slug_id?: string
          status?: Database["public"]["Enums"]["object_status"]
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      page_objects: {
        Row: {
          created_at: string
          object_id: string
          page_id: string
        }
        Insert: {
          created_at?: string
          object_id: string
          page_id: string
        }
        Update: {
          created_at?: string
          object_id?: string
          page_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_objects_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_objects_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      page_redirects: {
        Row: {
          created_at: string
          from_path: string
          id: string
          page_id: string | null
          to_path: string
        }
        Insert: {
          created_at?: string
          from_path: string
          id?: string
          page_id?: string | null
          to_path: string
        }
        Update: {
          created_at?: string
          from_path?: string
          id?: string
          page_id?: string | null
          to_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_redirects_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          archived_at: string | null
          build_status: string
          content: Json | null
          created_at: string
          description: string | null
          end_at: string | null
          id: string
          inline_edits: Json
          name: string
          notes: string | null
          page_type: string
          path: string
          preview_url: string | null
          scaffold_dismissed: boolean
          slug_id: string
          start_at: string | null
          status: string
          tags: string[]
          thumbnail_build_version: string | null
          thumbnail_updated_at: string | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          build_status?: string
          content?: Json | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          id?: string
          inline_edits?: Json
          name: string
          notes?: string | null
          page_type?: string
          path: string
          preview_url?: string | null
          scaffold_dismissed?: boolean
          slug_id: string
          start_at?: string | null
          status?: string
          tags?: string[]
          thumbnail_build_version?: string | null
          thumbnail_updated_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          build_status?: string
          content?: Json | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          id?: string
          inline_edits?: Json
          name?: string
          notes?: string | null
          page_type?: string
          path?: string
          preview_url?: string | null
          scaffold_dismissed?: boolean
          slug_id?: string
          start_at?: string | null
          status?: string
          tags?: string[]
          thumbnail_build_version?: string | null
          thumbnail_updated_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      product_mappings: {
        Row: {
          content_hash: string
          created_at: string
          id: string
          last_synced_at: string
          leaf_category: string | null
          shopify_product_id: string
          source_url: string
          updated_at: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          id?: string
          last_synced_at?: string
          leaf_category?: string | null
          shopify_product_id: string
          source_url: string
          updated_at?: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          id?: string
          last_synced_at?: string
          leaf_category?: string | null
          shopify_product_id?: string
          source_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      render_tokens: {
        Row: {
          created_at: string
          expires_at: string
          purpose: string
          token: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          purpose: string
          token?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          purpose?: string
          token?: string
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          leaf_category: string | null
          message: string | null
          run_id: string
          severity: string
          shopify_product_id: string | null
          source_url: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          leaf_category?: string | null
          message?: string | null
          run_id: string
          severity?: string
          shopify_product_id?: string | null
          source_url?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          leaf_category?: string | null
          message?: string | null
          run_id?: string
          severity?: string
          shopify_product_id?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          created_at: string
          current_leaf: string | null
          dry_run: boolean
          error_message: string | null
          errors: number
          finished_at: string | null
          id: string
          leaf_queue: Json
          leaves_done: number
          leaves_total: number
          per_leaf_cap: number
          products_archived: number
          products_created: number
          products_skipped: number
          products_updated: number
          started_at: string
          status: string
          trigger: string
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_leaf?: string | null
          dry_run?: boolean
          error_message?: string | null
          errors?: number
          finished_at?: string | null
          id?: string
          leaf_queue?: Json
          leaves_done?: number
          leaves_total?: number
          per_leaf_cap?: number
          products_archived?: number
          products_created?: number
          products_skipped?: number
          products_updated?: number
          started_at?: string
          status?: string
          trigger?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_leaf?: string | null
          dry_run?: boolean
          error_message?: string | null
          errors?: number
          finished_at?: string | null
          id?: string
          leaf_queue?: Json
          leaves_done?: number
          leaves_total?: number
          per_leaf_cap?: number
          products_archived?: number
          products_created?: number
          products_skipped?: number
          products_updated?: number
          started_at?: string
          status?: string
          trigger?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          color_index: number | null
          created_at: string
          depth: number
          id: string
          name: string
          parent_id: string | null
          scope: string
        }
        Insert: {
          color_index?: number | null
          created_at?: string
          depth?: number
          id?: string
          name: string
          parent_id?: string | null
          scope: string
        }
        Update: {
          color_index?: number | null
          created_at?: string
          depth?: number
          id?: string
          name?: string
          parent_id?: string | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      trusted_review_domains: {
        Row: {
          created_at: string
          created_by: string | null
          domain: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          domain: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          domain?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_page_usages: {
        Row: {
          created_at: string
          page_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          page_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          page_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_page_usages_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_page_usages_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          alt_bytes: number | null
          alt_mime: string | null
          alt_path: string | null
          alt_text: string
          alt_url: string | null
          archived_at: string | null
          created_at: string
          description: string
          duration_seconds: number | null
          external_url: string | null
          external_video_id: string | null
          file_bytes: number | null
          height: number | null
          id: string
          name: string
          poster_path: string | null
          poster_url: string | null
          slug_id: string | null
          source_type: string
          storage_path: string | null
          storage_url: string | null
          tags: string[]
          updated_at: string
          visibility: string
          width: number | null
        }
        Insert: {
          alt_bytes?: number | null
          alt_mime?: string | null
          alt_path?: string | null
          alt_text?: string
          alt_url?: string | null
          archived_at?: string | null
          created_at?: string
          description?: string
          duration_seconds?: number | null
          external_url?: string | null
          external_video_id?: string | null
          file_bytes?: number | null
          height?: number | null
          id?: string
          name: string
          poster_path?: string | null
          poster_url?: string | null
          slug_id?: string | null
          source_type: string
          storage_path?: string | null
          storage_url?: string | null
          tags?: string[]
          updated_at?: string
          visibility?: string
          width?: number | null
        }
        Update: {
          alt_bytes?: number | null
          alt_mime?: string | null
          alt_path?: string | null
          alt_text?: string
          alt_url?: string | null
          archived_at?: string | null
          created_at?: string
          description?: string
          duration_seconds?: number | null
          external_url?: string | null
          external_video_id?: string | null
          file_bytes?: number | null
          height?: number | null
          id?: string
          name?: string
          poster_path?: string | null
          poster_url?: string | null
          slug_id?: string | null
          source_type?: string
          storage_path?: string | null
          storage_url?: string | null
          tags?: string[]
          updated_at?: string
          visibility?: string
          width?: number | null
        }
        Relationships: []
      }
      wishlist_items: {
        Row: {
          added_at: string
          id: string
          sku: string
          wishlist_id: string
        }
        Insert: {
          added_at?: string
          id?: string
          sku: string
          wishlist_id: string
        }
        Update: {
          added_at?: string
          id?: string
          sku?: string
          wishlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_wishlist_id_fkey"
            columns: ["wishlist_id"]
            isOneToOne: false
            referencedRelation: "wishlists"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlists: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_slug_id: { Args: { name_input: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_site_user: { Args: never; Returns: boolean }
      sanitize_media_display_name: {
        Args: { fallback?: string; value: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "user"
      object_status: "Planned" | "In Progress" | "Built"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      object_status: ["Planned", "In Progress", "Built"],
    },
  },
} as const
