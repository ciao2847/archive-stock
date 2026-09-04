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
      customers: {
        Row: {
          contact: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          nickname: string | null
          notes: string | null
          owner_id: string
        }
        Insert: {
          contact?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          nickname?: string | null
          notes?: string | null
          owner_id?: string
        }
        Update: {
          contact?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          nickname?: string | null
          notes?: string | null
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      location_movements: {
        Row: {
          from_location_id: string | null
          id: string
          moved_at: string
          moved_by: string | null
          product_id: string
          to_location_id: string
        }
        Insert: {
          from_location_id?: string | null
          id?: string
          moved_at?: string
          moved_by?: string | null
          product_id: string
          to_location_id: string
        }
        Update: {
          from_location_id?: string | null
          id?: string
          moved_at?: string
          moved_by?: string | null
          product_id?: string
          to_location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_movements_moved_by_fkey"
            columns: ["moved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          bin: number | null
          cabinet: string | null
          code: string
          created_at: string
          description: string | null
          id: string
          owner_id: string
          shelf: number | null
        }
        Insert: {
          bin?: number | null
          cabinet?: string | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          owner_id?: string
          shelf?: number | null
        }
        Update: {
          bin?: number | null
          cabinet?: string | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          owner_id?: string
          shelf?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          quantity: number
          scanned_quantity: number
          unit_price: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          quantity?: number
          scanned_quantity?: number
          unit_price?: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          scanned_quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          discount: number
          id: string
          notes: string | null
          order_no: string
          owner_id: string
          packed_at: string | null
          packed_by: string | null
          payment_status: string
          platform_fee: number
          sales_channel: string
          seller_shipping_cost: number
          shipped_at: string | null
          shipping_income: number
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          discount?: number
          id?: string
          notes?: string | null
          order_no?: string
          owner_id?: string
          packed_at?: string | null
          packed_by?: string | null
          payment_status?: string
          platform_fee?: number
          sales_channel?: string
          seller_shipping_cost?: number
          shipped_at?: string | null
          shipping_income?: number
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          discount?: number
          id?: string
          notes?: string | null
          order_no?: string
          owner_id?: string
          packed_at?: string | null
          packed_by?: string | null
          payment_status?: string
          platform_fee?: number
          sales_channel?: string
          seller_shipping_cost?: number
          shipped_at?: string | null
          shipping_income?: number
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_packed_by_fkey"
            columns: ["packed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_scans: {
        Row: {
          id: string
          is_valid: boolean
          order_id: string
          product_id: string
          scan_method: string
          scanned_at: string
          scanned_by: string
        }
        Insert: {
          id?: string
          is_valid: boolean
          order_id: string
          product_id: string
          scan_method?: string
          scanned_at?: string
          scanned_by: string
        }
        Update: {
          id?: string
          is_valid?: boolean
          order_id?: string
          product_id?: string
          scan_method?: string
          scanned_at?: string
          scanned_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_scans_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_scans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_scans_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_qr_labels: {
        Row: {
          batch_code: string | null
          created_at: string
          id: string
          product_id: string
          status: string
          token: string
          used_at: string | null
          used_by: string | null
          used_order_id: string | null
        }
        Insert: {
          batch_code?: string | null
          created_at?: string
          id?: string
          product_id: string
          status?: string
          token?: string
          used_at?: string | null
          used_by?: string | null
          used_order_id?: string | null
        }
        Update: {
          batch_code?: string | null
          created_at?: string
          id?: string
          product_id?: string
          status?: string
          token?: string
          used_at?: string | null
          used_by?: string | null
          used_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_qr_labels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_qr_labels_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_qr_labels_used_order_id_fkey"
            columns: ["used_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string
          cinema: string | null
          cost: number | null
          country: string | null
          created_at: string
          created_by: string | null
          edition: string | null
          id: string
          identifying_features: string | null
          image_paths: string[] | null
          is_art_set: boolean | null
          location_id: string | null
          name: string
          notes: string | null
          owner_id: string
          poster_crafts: string[] | null
          poster_format: string | null
          poster_size: string | null
          price: number | null
          release_date: string | null
          sku: string
          source: string | null
          status: Database["public"]["Enums"]["product_status"]
          stock: number
          style_name: string | null
          updated_at: string
          work_id: string | null
        }
        Insert: {
          category: string
          cinema?: string | null
          cost?: number | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          edition?: string | null
          id?: string
          identifying_features?: string | null
          image_paths?: string[] | null
          is_art_set?: boolean | null
          location_id?: string | null
          name: string
          notes?: string | null
          owner_id?: string
          poster_crafts?: string[] | null
          poster_format?: string | null
          poster_size?: string | null
          price?: number | null
          release_date?: string | null
          sku?: string
          source?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number
          style_name?: string | null
          updated_at?: string
          work_id?: string | null
        }
        Update: {
          category?: string
          cinema?: string | null
          cost?: number | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          edition?: string | null
          id?: string
          identifying_features?: string | null
          image_paths?: string[] | null
          is_art_set?: boolean | null
          location_id?: string | null
          name?: string
          notes?: string | null
          owner_id?: string
          poster_crafts?: string[] | null
          poster_format?: string | null
          poster_size?: string | null
          price?: number | null
          release_date?: string | null
          sku?: string
          source?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number
          style_name?: string | null
          updated_at?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      settlement_orders: {
        Row: {
          order_id: string
          revenue: number
          settlement_id: string
        }
        Insert: {
          order_id: string
          revenue: number
          settlement_id: string
        }
        Update: {
          order_id?: string
          revenue?: number
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_orders_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_products: {
        Row: {
          cost: number
          product_id: string
          settlement_id: string
        }
        Insert: {
          cost: number
          product_id: string
          settlement_id: string
        }
        Update: {
          cost?: number
          product_id?: string
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_products_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          cost: number
          created_at: string
          created_by: string
          id: string
          owner_id: string
          period_end: string | null
          period_start: string | null
          profit: number | null
          revenue: number
          settlement_no: string
        }
        Insert: {
          cost?: number
          created_at?: string
          created_by: string
          id?: string
          owner_id?: string
          period_end?: string | null
          period_start?: string | null
          profit?: number | null
          revenue?: number
          settlement_no?: string
        }
        Update: {
          cost?: number
          created_at?: string
          created_by?: string
          id?: string
          owner_id?: string
          period_end?: string | null
          period_start?: string | null
          profit?: number | null
          revenue?: number
          settlement_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      works: {
        Row: {
          code: string
          created_at: string
          id: string
          image_path: string | null
          release_year: number | null
          title_en: string | null
          title_ja: string | null
          title_ko: string | null
          title_zh: string
        }
        Insert: {
          code?: string
          created_at?: string
          id?: string
          image_path?: string | null
          release_year?: number | null
          title_en?: string | null
          title_ja?: string | null
          title_ko?: string | null
          title_zh: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          image_path?: string | null
          release_year?: number | null
          title_en?: string | null
          title_ja?: string | null
          title_ko?: string | null
          title_zh?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_product_stock: {
        Args: { p_new_stock: number; p_product_id: string }
        Returns: number
      }
      archive_order: { Args: { p_order_id: string }; Returns: boolean }
      complete_order_packing: { Args: { p_order_id: string }; Returns: boolean }
      consume_product_qr: {
        Args: { p_order_id: string; p_token: string }
        Returns: {
          product_id: string
          reason: string
          sku: string
          valid: boolean
        }[]
      }
      consume_product_sku: {
        Args: { p_order_id: string; p_sku: string }
        Returns: {
          product_id: string
          reason: string
          sku: string
          valid: boolean
        }[]
      }
      create_financial_settlement: {
        Args: { p_end?: string; p_owner_id: string; p_start?: string }
        Returns: {
          cost: number
          created_at: string
          created_by: string
          id: string
          owner_id: string
          period_end: string | null
          period_start: string | null
          profit: number | null
          revenue: number
          settlement_no: string
        }
        SetofOptions: {
          from: "*"
          to: "settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_inventory_product: {
        Args: {
          p_category: string
          p_cost: number
          p_country: string
          p_identifying_features: string
          p_image_paths: string[]
          p_location: string
          p_name: string
          p_owner_id: string
          p_poster_crafts: string[]
          p_poster_format: string
          p_poster_size: string
          p_price: number
          p_source: string
          p_stock: number
          p_work: string
        }
        Returns: string
      }
      create_order_with_items: {
        Args: {
          p_customer_contact: string
          p_customer_name: string
          p_customer_nickname: string
          p_discount: number
          p_items: Json
          p_notes: string
          p_payment_status: string
          p_platform_fee: number
          p_sales_channel: string
          p_seller_shipping_cost: number
          p_shipping_income: number
        }
        Returns: string
      }
      delete_inventory_product: {
        Args: { p_product_id: string }
        Returns: string[]
      }
      get_admin_product_costs: {
        Args: never
        Returns: {
          cost: number
          product_id: string
        }[]
      }
      get_public_qr_landing: {
        Args: { p_channel?: string; p_token: string }
        Returns: {
          order_no: string
          order_status: string
          qr_status: string
          recommendations: Json
          sales_channel: string
        }[]
      }
      my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      set_admin_product_cost: {
        Args: { p_cost: number; p_product_id: string }
        Returns: undefined
      }
      update_inventory_product: {
        Args: {
          p_category: string
          p_cost: number
          p_country: string
          p_identifying_features: string
          p_location: string
          p_name: string
          p_poster_format: string
          p_poster_size: string
          p_price: number
          p_product_id: string
          p_source: string
          p_stock: number
        }
        Returns: boolean
      }
      update_order_details: {
        Args: {
          p_customer_contact: string
          p_customer_name: string
          p_customer_nickname: string
          p_discount: number
          p_items: Json
          p_notes: string
          p_order_id: string
          p_payment_status: string
          p_platform_fee: number
          p_sales_channel: string
          p_seller_shipping_cost: number
          p_shipping_income: number
        }
        Returns: boolean
      }
      update_order_financials: {
        Args: {
          p_discount: number
          p_items: Json
          p_order_id: string
          p_platform_fee: number
          p_sales_channel: string
          p_seller_shipping_cost: number
          p_shipping_income: number
        }
        Returns: boolean
      }
    }
    Enums: {
      order_status: "pending" | "packing" | "packed" | "shipped" | "cancelled"
      product_status: "in_stock" | "reserved" | "packing" | "packed" | "shipped"
      user_role: "admin" | "staff"
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
      order_status: ["pending", "packing", "packed", "shipped", "cancelled"],
      product_status: ["in_stock", "reserved", "packing", "packed", "shipped"],
      user_role: ["admin", "staff"],
    },
  },
} as const
