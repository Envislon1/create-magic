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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cn_friend_requests: {
        Row: {
          created_at: string
          from_user: string
          id: string
          status: Database["public"]["Enums"]["cn_request_status"]
          to_user: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_user: string
          id?: string
          status?: Database["public"]["Enums"]["cn_request_status"]
          to_user: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_user?: string
          id?: string
          status?: Database["public"]["Enums"]["cn_request_status"]
          to_user?: string
          updated_at?: string
        }
        Relationships: []
      }
      cn_user_locations: {
        Row: {
          is_visible: boolean
          lat: number
          lng: number
          radius_km: number
          updated_at: string
          user_id: string
        }
        Insert: {
          is_visible?: boolean
          lat: number
          lng: number
          radius_km?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          is_visible?: boolean
          lat?: number
          lng?: number
          radius_km?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      connection_members: {
        Row: {
          joined_at: string
          last_read_at: string
          room_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          last_read_at?: string
          room_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          last_read_at?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connection_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          conn_type: string
          created_at: string
          created_by: string | null
          display_name: string | null
          group_avatar: string | null
          id: string
          last_message_at: string
        }
        Insert: {
          conn_type?: string
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          group_avatar?: string | null
          id?: string
          last_message_at?: string
        }
        Update: {
          conn_type?: string
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          group_avatar?: string | null
          id?: string
          last_message_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string | null
          created_at: string
          deleted_for_everyone: boolean
          edited: boolean
          id: string
          media_meta: Json | null
          media_url: string | null
          msg_type: string
          reply_to: string | null
          room_id: string
          sender_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          deleted_for_everyone?: boolean
          edited?: boolean
          id?: string
          media_meta?: Json | null
          media_url?: string | null
          msg_type?: string
          reply_to?: string | null
          room_id: string
          sender_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          deleted_for_everyone?: boolean
          edited?: boolean
          id?: string
          media_meta?: Json | null
          media_url?: string | null
          msg_type?: string
          reply_to?: string | null
          room_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          about: string | null
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          last_seen: string
          online_status: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          about?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id: string
          last_seen?: string
          online_status?: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          about?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          last_seen?: string
          online_status?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      status_updates: {
        Row: {
          background_color: string | null
          caption: string | null
          created_at: string
          expires_at: string
          id: string
          media_type: string
          media_url: string | null
          user_id: string
        }
        Insert: {
          background_color?: string | null
          caption?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          media_type?: string
          media_url?: string | null
          user_id: string
        }
        Update: {
          background_color?: string | null
          caption?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          media_type?: string
          media_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      status_views: {
        Row: {
          status_id: string
          viewed_at: string
          viewer_id: string
        }
        Insert: {
          status_id: string
          viewed_at?: string
          viewer_id: string
        }
        Update: {
          status_id?: string
          viewed_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_views_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "status_updates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cn_nearby_users: {
        Args: { _lat: number; _lng: number; _radius_km: number }
        Returns: {
          about: string
          avatar_url: string
          display_name: string
          distance_km: number
          user_id: string
        }[]
      }
      get_or_create_direct_room: {
        Args: { _other_user: string }
        Returns: string
      }
      is_room_member: {
        Args: { _room: string; _user: string }
        Returns: boolean
      }
    }
    Enums: {
      cn_request_status: "pending" | "accepted" | "declined"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      cn_request_status: ["pending", "accepted", "declined"],
    },
  },
} as const
