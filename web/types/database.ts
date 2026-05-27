// Tipos generados del schema de Supabase.
// Regenerar cuando cambien las migraciones: supabase gen types typescript --local > web/types/database.ts

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          role: 'admin' | 'staff' | 'guide';
          full_name: string;
          phone: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          role?: 'admin' | 'staff' | 'guide';
          full_name: string;
          phone?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          role?: 'admin' | 'staff' | 'guide';
          full_name?: string;
          phone?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tours: {
        Row: {
          id: string;
          slug: string;
          name_es: string;
          name_en: string;
          description_es: string;
          description_en: string;
          difficulty: 'easy' | 'moderate' | 'hard';
          duration_minutes: number;
          meeting_point_es: string;
          meeting_point_en: string;
          includes_es: string;
          includes_en: string;
          min_participants: number;
          max_capacity: number;
          cover_image_url: string | null;
          status: 'active' | 'archived';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name_es: string;
          name_en: string;
          description_es: string;
          description_en: string;
          difficulty: 'easy' | 'moderate' | 'hard';
          duration_minutes: number;
          meeting_point_es: string;
          meeting_point_en: string;
          includes_es: string;
          includes_en: string;
          min_participants?: number;
          max_capacity: number;
          cover_image_url?: string | null;
          status?: 'active' | 'archived';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name_es?: string;
          name_en?: string;
          description_es?: string;
          description_en?: string;
          difficulty?: 'easy' | 'moderate' | 'hard';
          duration_minutes?: number;
          meeting_point_es?: string;
          meeting_point_en?: string;
          includes_es?: string;
          includes_en?: string;
          min_participants?: number;
          max_capacity?: number;
          cover_image_url?: string | null;
          status?: 'active' | 'archived';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tour_pricing: {
        Row: {
          id: string;
          tour_id: string;
          ticket_type: 'adult' | 'child' | 'student';
          price_usd: number;
          season_label: string | null;
          valid_from: string | null;
          valid_until: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          ticket_type: 'adult' | 'child' | 'student';
          price_usd: number;
          season_label?: string | null;
          valid_from?: string | null;
          valid_until?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          ticket_type?: 'adult' | 'child' | 'student';
          price_usd?: number;
          season_label?: string | null;
          valid_from?: string | null;
          valid_until?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_pricing_tour_id_fkey';
            columns: ['tour_id'];
            isOneToOne: false;
            referencedRelation: 'tours';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_schedules: {
        Row: {
          id: string;
          tour_id: string;
          day_of_week: number;
          start_time: string;
          capacity: number;
          valid_from: string;
          valid_until: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          day_of_week: number;
          start_time: string;
          capacity: number;
          valid_from?: string;
          valid_until?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          day_of_week?: number;
          start_time?: string;
          capacity?: number;
          valid_from?: string;
          valid_until?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_schedules_tour_id_fkey';
            columns: ['tour_id'];
            isOneToOne: false;
            referencedRelation: 'tours';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_instances: {
        Row: {
          id: string;
          tour_id: string;
          schedule_id: string;
          starts_at: string;
          ends_at: string;
          capacity_total: number;
          capacity_reserved: number;
          status: 'available' | 'full' | 'cancelled';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          schedule_id: string;
          starts_at: string;
          ends_at: string;
          capacity_total: number;
          capacity_reserved?: number;
          status?: 'available' | 'full' | 'cancelled';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          schedule_id?: string;
          starts_at?: string;
          ends_at?: string;
          capacity_total?: number;
          capacity_reserved?: number;
          status?: 'available' | 'full' | 'cancelled';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_instances_tour_id_fkey';
            columns: ['tour_id'];
            isOneToOne: false;
            referencedRelation: 'tours';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tour_instances_schedule_id_fkey';
            columns: ['schedule_id'];
            isOneToOne: false;
            referencedRelation: 'tour_schedules';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_holds: {
        Row: {
          id: string;
          tour_instance_id: string;
          session_token: string;
          held_seats: number;
          status: 'active' | 'released' | 'expired' | 'converted';
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_instance_id: string;
          session_token: string;
          held_seats: number;
          status?: 'active' | 'released' | 'expired' | 'converted';
          expires_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_instance_id?: string;
          session_token?: string;
          held_seats?: number;
          status?: 'active' | 'released' | 'expired' | 'converted';
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_holds_tour_instance_id_fkey';
            columns: ['tour_instance_id'];
            isOneToOne: false;
            referencedRelation: 'tour_instances';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_hold_atomic: {
        Args: { p_instance_id: string; p_seats: number; p_session: string };
        Returns: {
          id: string;
          tour_instance_id: string;
          session_token: string;
          held_seats: number;
          status: 'active' | 'released' | 'expired' | 'converted';
          expires_at: string;
          created_at: string;
        };
      };
    };
    Enums: {
      user_role: 'admin' | 'staff' | 'guide';
      tour_status: 'active' | 'archived';
      ticket_type: 'adult' | 'child' | 'student';
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T];
