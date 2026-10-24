-- ══════════════════════════════════════════════════════════════════════
--  Tecnocore · esquema de base de datos (PostgreSQL / Supabase)
-- ══════════════════════════════════════════════════════════════════════
--  Todo vive en el esquema privado "tc". Supabase solo expone por su API
--  REST los esquemas configurados (public por defecto), así que estas
--  tablas solo son accesibles a través de la Edge Function "api".
--  El script es idempotente: se puede ejecutar más de una vez.
-- ══════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS tc;

-- Ajustes de la tienda (clave / valor)
CREATE TABLE IF NOT EXISTS tc.settings (
  k text PRIMARY KEY,
  v text NOT NULL
);

-- Cuentas del equipo: admin, empleado y rider
CREATE TABLE IF NOT EXISTS tc.users (
  id            serial PRIMARY KEY,
  role          text NOT NULL CHECK (role IN ('admin', 'empleado', 'rider')),
  username      text NOT NULL UNIQUE,
  password_hash text,
  name          text NOT NULL,
  phone         text NOT NULL DEFAULT '',
  active        boolean NOT NULL DEFAULT true,
  available     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Sesiones (se guarda solo el hash del token)
CREATE TABLE IF NOT EXISTS tc.sessions (
  token_hash text PRIMARY KEY,
  user_id    int NOT NULL REFERENCES tc.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON tc.sessions (user_id);

-- Imágenes: fotos de productos (públicas) y comprobantes (privados)
CREATE TABLE IF NOT EXISTS tc.images (
  id         text PRIMARY KEY,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  is_private boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc.products (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  category    text NOT NULL,
  brand       text NOT NULL DEFAULT '',
  specs       text NOT NULL DEFAULT '',
  price       numeric(12, 2) NOT NULL CHECK (price >= 0),
  offer_price numeric(12, 2) CHECK (offer_price >= 0),
  stock       int NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sku         text NOT NULL DEFAULT '',
  image_id    text REFERENCES tc.images(id) ON DELETE SET NULL,
  image_url   text,
  active      boolean NOT NULL DEFAULT true,
  views       int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Pedidos hechos por clientes desde el catálogo
CREATE TABLE IF NOT EXISTS tc.orders (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  customer_name  text NOT NULL,
  customer_phone text NOT NULL,
  delivery       boolean NOT NULL DEFAULT false,
  address        text NOT NULL DEFAULT '',
  payment_method text NOT NULL CHECK (payment_method IN ('efectivo', 'transferencia')),
  notes          text NOT NULL DEFAULT '',
  items          jsonb NOT NULL,
  total          numeric(12, 2) NOT NULL,
  status         text NOT NULL DEFAULT 'nuevo'
                 CHECK (status IN ('nuevo', 'confirmado', 'en_camino', 'entregado', 'cancelado')),
  seen           boolean NOT NULL DEFAULT false,
  sale_id        int,
  rider_id       int REFERENCES tc.users(id),
  rider_status   text CHECK (rider_status IN ('asignado', 'aceptado', 'recogido', 'entregado')),
  rejected_by    jsonb NOT NULL DEFAULT '[]'::jsonb,
  rider_fee      numeric(12, 2),
  assigned_at    timestamptz,
  accepted_at    timestamptz,
  picked_at      timestamptz,
  delivered_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_status_idx ON tc.orders (status);
CREATE INDEX IF NOT EXISTS orders_rider_idx ON tc.orders (rider_id, rider_status);

-- Ventas: del punto de venta (pos) y pedidos en línea concretados (online)
CREATE TABLE IF NOT EXISTS tc.sales (
  id               serial PRIMARY KEY,
  channel          text NOT NULL CHECK (channel IN ('pos', 'online')),
  seller_id        int REFERENCES tc.users(id),
  seller_name      text NOT NULL,
  items            jsonb NOT NULL,
  subtotal         numeric(12, 2) NOT NULL,
  discount         numeric(12, 2) NOT NULL DEFAULT 0,
  tax              numeric(12, 2) NOT NULL DEFAULT 0,
  total            numeric(12, 2) NOT NULL,
  payment_method   text NOT NULL CHECK (payment_method IN ('efectivo', 'transferencia')),
  bank             text,
  cash_received    numeric(12, 2),
  change_given     numeric(12, 2),
  receipt_image_id text REFERENCES tc.images(id) ON DELETE SET NULL,
  order_id         int REFERENCES tc.orders(id),
  voided           boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_created_idx ON tc.sales (created_at);
CREATE INDEX IF NOT EXISTS sales_seller_idx ON tc.sales (seller_id, created_at);

-- Consultas de clientes: interés en un producto, pedido de ayuda o reporte
CREATE TABLE IF NOT EXISTS tc.inquiries (
  id             serial PRIMARY KEY,
  type           text NOT NULL CHECK (type IN ('interes', 'ayuda', 'reporte')),
  customer_name  text NOT NULL,
  customer_phone text NOT NULL DEFAULT '',
  product_id     int REFERENCES tc.products(id) ON DELETE SET NULL,
  product_name   text,
  order_code     text,
  rider_id       int REFERENCES tc.users(id),
  message        text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'nuevo' CHECK (status IN ('nuevo', 'atendido')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inquiries_status_idx ON tc.inquiries (status, type);

-- Límite de intentos (inicio de sesión, pedidos, consultas)
CREATE TABLE IF NOT EXISTS tc.rate_limits (
  key      text PRIMARY KEY,
  hits     int NOT NULL,
  reset_at timestamptz NOT NULL
);

-- Ningún rol público de Supabase (anon / authenticated) puede tocar el esquema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA tc FROM anon, authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA tc FROM anon, authenticated;
  END IF;
END $$;
REVOKE ALL ON SCHEMA tc FROM PUBLIC;

-- RLS sin políticas como segunda barrera: solo el dueño de las tablas (la API) las usa.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'tc' LOOP
    EXECUTE format('ALTER TABLE tc.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
