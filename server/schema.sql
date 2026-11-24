-- هجوم | نموذج البيانات - المرحلة الأولى
-- الوحدات: الكميات بالملّيلتر (INTEGER)، المبالغ بالهللة (INTEGER)، الأوقات ISO-8601 UTC وتعرض بتوقيت الرياض
PRAGMA foreign_keys = ON;

-- ========== الحسابات والعضويات ==========
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('client','carrier','supplier','platform')),
  name_ar TEXT NOT NULL,
  name_en TEXT,
  cr_number TEXT,
  vat_number TEXT,
  city TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended','rejected')),
  is_demo INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- مستخدم واحد قد ينتمي لعدة شركات بصلاحيات مستقلة
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL CHECK (role IN ('client_admin','procurement','project_manager','fuel_supervisor','finance',
                                     'carrier_admin','dispatcher','driver','site_receiver','platform_admin')),
  scope_project_id TEXT,
  scope_site_id TEXT,
  approval_limit_halalas INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, company_id, role)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  membership_id TEXT NOT NULL REFERENCES memberships(id),
  expires_at TEXT NOT NULL
);

-- ========== الملفات الخاصة ==========
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL,              -- aramco_doc | trip_photo | company_doc | meter_photo
  original_name TEXT,
  mime TEXT,
  size INTEGER,
  storage_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  scan_status TEXT NOT NULL DEFAULT 'clean',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS file_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL REFERENCES files(id),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  action TEXT NOT NULL,            -- view | download
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS company_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  doc_type TEXT NOT NULL,          -- cr | vat | transport_license | insurance | ...
  number TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  note TEXT
);

-- ========== هيكل الشركة العميلة ==========
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), name TEXT NOT NULL, city TEXT
);
CREATE TABLE IF NOT EXISTS cost_centers (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), code TEXT NOT NULL, name TEXT NOT NULL,
  UNIQUE (company_id, code)
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  branch_id TEXT REFERENCES branches(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  cost_center_id TEXT REFERENCES cost_centers(id),
  budget_ml INTEGER,
  budget_halalas INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE (company_id, code)
);
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  lat REAL, lng REAL,
  receiver_name TEXT, receiver_phone TEXT, access_notes TEXT
);
CREATE TABLE IF NOT EXISTS tanks (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  product TEXT NOT NULL,
  capacity_ml INTEGER NOT NULL,
  reorder_ml INTEGER NOT NULL DEFAULT 0,
  reading_source TEXT NOT NULL DEFAULT 'manual',
  responsible_user_id TEXT,
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,              -- الرقم الداخلي
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('heavy_equipment','generator','vehicle','fixed')),
  fuel_type TEXT NOT NULL,
  plate_or_serial TEXT,
  project_id TEXT REFERENCES projects(id),
  site_id TEXT REFERENCES sites(id),
  cost_center_id TEXT REFERENCES cost_centers(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','maintenance')),
  tank_capacity_ml INTEGER,
  meter_type TEXT NOT NULL DEFAULT 'none' CHECK (meter_type IN ('km','hours','none')),
  per_tx_limit_ml INTEGER,
  daily_limit_ml INTEGER,
  monthly_limit_ml INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (company_id, code)
);
-- سجل نقل الأصل بين المشاريع بتاريخ نفاذ
CREATE TABLE IF NOT EXISTS asset_assignments (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  project_id TEXT, site_id TEXT, cost_center_id TEXT,
  effective_from TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ========== شرائح NFC ==========
CREATE TABLE IF NOT EXISTS nfc_tags (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  uid TEXT NOT NULL UNIQUE,        -- المعرف التقني (غير دال على العميل أو المعدة)
  display_no TEXT NOT NULL,        -- الرقم الظاهر للإدارة
  batch_no TEXT,
  status TEXT NOT NULL DEFAULT 'in_custody'
    CHECK (status IN ('in_custody','pending_activation','active','suspended','lost','damaged','replaced')),
  asset_id TEXT REFERENCES assets(id),
  custodian_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- شريحة نشطة واحدة لكل أصل
CREATE UNIQUE INDEX IF NOT EXISTS ux_one_active_tag_per_asset ON nfc_tags(asset_id) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS nfc_tag_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id TEXT REFERENCES nfc_tags(id),
  company_id TEXT NOT NULL,
  uid TEXT,
  asset_id TEXT,
  action TEXT NOT NULL,            -- issue | bind | activate | suspend | lost | damaged | replace | unbind | read | rejected
  result TEXT,
  reason TEXT,
  by_user TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ========== الناقلون والأسطول والتسعير ==========
CREATE TABLE IF NOT EXISTS loading_points (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, city TEXT NOT NULL, lat REAL, lng REAL
);
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  plate TEXT NOT NULL,
  capacity_ml INTEGER NOT NULL,
  products TEXT NOT NULL,          -- قائمة مفصولة بفواصل
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','suspended')),
  docs_valid_until TEXT,
  UNIQUE (company_id, plate)
);
CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT,
  license_no TEXT,
  license_expiry TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'))
);
CREATE TABLE IF NOT EXISTS carrier_coverage (
  id TEXT PRIMARY KEY,
  carrier_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL CHECK (kind IN ('loading','delivery')),
  ref TEXT NOT NULL,               -- loading_point_id أو المدينة
  UNIQUE (carrier_id, kind, ref)
);
CREATE TABLE IF NOT EXISTS route_prices (
  id TEXT PRIMARY KEY,
  carrier_id TEXT NOT NULL REFERENCES companies(id),
  loading_point_id TEXT NOT NULL REFERENCES loading_points(id),
  delivery_city TEXT NOT NULL,
  product TEXT NOT NULL,
  pricing_type TEXT NOT NULL CHECK (pricing_type IN ('fixed','per_1000l')),
  price_halalas INTEGER NOT NULL,
  waiting_fee_halalas_per_hour INTEGER NOT NULL DEFAULT 0,
  cancel_fee_halalas INTEGER NOT NULL DEFAULT 0,
  free_waiting_hours INTEGER NOT NULL DEFAULT 2,
  accept_within_minutes INTEGER NOT NULL DEFAULT 120,
  active INTEGER NOT NULL DEFAULT 1
);

-- ========== مستند أرامكو ==========
CREATE TABLE IF NOT EXISTS aramco_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  file_id TEXT NOT NULL REFERENCES files(id),
  version INTEGER NOT NULL DEFAULT 1,
  doc_number TEXT,
  loading_point_id TEXT REFERENCES loading_points(id),
  product TEXT,
  authorized_ml INTEGER,
  issue_date TEXT,
  expiry_date TEXT,
  extraction_json TEXT,            -- الحقول المستخرجة ودرجة الثقة
  duplicate_of TEXT,               -- عند رفع نفس الملف مرة أخرى
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review','approved','rejected')),
  approved_by TEXT,
  approved_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_number ON aramco_documents(company_id, doc_number) WHERE status = 'approved';

-- ========== الطلب والرحلة ==========
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT REFERENCES projects(id),
  created_by TEXT NOT NULL,
  product TEXT NOT NULL,
  quantity_ml INTEGER NOT NULL,
  loading_point_id TEXT NOT NULL REFERENCES loading_points(id),
  aramco_document_id TEXT REFERENCES aramco_documents(id),
  requested_date TEXT NOT NULL,
  window_start TEXT, window_end TEXT,
  carrier_id TEXT REFERENCES companies(id),
  route_price_id TEXT,
  price_snapshot_json TEXT,        -- نسخة السعر المتفق عليه والشروط
  transport_halalas INTEGER,
  fuel_price_halalas_per_l INTEGER, -- سعر لتر الوقود إن كان معلومًا (NULL = غير متوفر)
  status TEXT NOT NULL DEFAULT 'pending_carrier'
    CHECK (status IN ('pending_carrier','accepted','in_progress','completed','cancelled','rejected')),
  idempotency_key TEXT UNIQUE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL REFERENCES orders(id),
  company_id TEXT NOT NULL REFERENCES companies(id),     -- العميل
  carrier_id TEXT NOT NULL REFERENCES companies(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  driver_id TEXT REFERENCES drivers(id),
  status TEXT NOT NULL DEFAULT 'awaiting_acceptance' CHECK (status IN (
    'awaiting_acceptance','awaiting_assignment','assigned','to_loading','at_loading','loaded',
    'to_delivery','at_site','delivered','under_review','closed','cancelled','rejected','on_hold')),
  planned_start TEXT NOT NULL,
  planned_end TEXT NOT NULL,
  window_start TEXT, window_end TEXT,
  accept_deadline TEXT,
  loaded_ml INTEGER,
  load_measure_method TEXT,
  reject_reason TEXT,
  cancel_reason TEXT,
  accepted_at TEXT, assigned_at TEXT, loaded_at TEXT, delivered_at TEXT, closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_trips_company ON trips(company_id, status);
CREATE INDEX IF NOT EXISTS ix_trips_carrier ON trips(carrier_id, status);
CREATE INDEX IF NOT EXISTS ix_trips_vehicle ON trips(vehicle_id, planned_start);

-- نقطة تسليم (رحلة واحدة قد تخدم عدة مواقع)
CREATE TABLE IF NOT EXISTS trip_stops (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id),
  seq INTEGER NOT NULL,
  site_id TEXT NOT NULL REFERENCES sites(id),
  mode TEXT NOT NULL CHECK (mode IN ('tank','direct')),  -- إلى خزان أو تزويد مباشر للمعدات
  tank_id TEXT REFERENCES tanks(id),
  requested_ml INTEGER NOT NULL,
  delivered_ml INTEGER,
  returned_ml INTEGER,
  measure_method TEXT,
  receiver_name TEXT, receiver_phone TEXT, access_notes TEXT,
  receiver_ack TEXT CHECK (receiver_ack IN ('confirmed','disputed')),
  receiver_ack_by TEXT,
  receiver_ack_at TEXT,
  receiver_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','arrived','delivered','confirmed','disputed')),
  receipt_token TEXT UNIQUE,       -- رابط محدود الصلاحية لمستلم الموقع
  arrived_at TEXT,
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS trip_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id TEXT NOT NULL REFERENCES trips(id),
  stop_id TEXT,
  type TEXT NOT NULL,
  from_status TEXT, to_status TEXT,
  actor_user_id TEXT,
  actor_role TEXT,
  note TEXT,
  lat REAL, lng REAL,
  captured_at TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  client_op_id TEXT UNIQUE         -- يمنع تكرار الحدث عند المزامنة
);

CREATE TABLE IF NOT EXISTS trip_photos (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id),
  stop_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('before_loading','after_loading','before_unloading','after_unloading')),
  file_id TEXT NOT NULL REFERENCES files(id),
  driver_id TEXT,
  lat REAL, lng REAL,
  captured_at TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  client_op_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS assignment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id TEXT NOT NULL REFERENCES trips(id),
  carrier_id TEXT, vehicle_id TEXT, driver_id TEXT,
  action TEXT NOT NULL,           -- offered | accepted | rejected | assigned | reassigned | released
  reason TEXT,
  by_user TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ========== المخزون (دفتر حركات موحد) ==========
-- دفعة وقود: ناتجة عن تسليم رحلة. وضع direct يعني رصيدًا مخصصًا للتزويد المباشر لا يدخل خزانًا
CREATE TABLE IF NOT EXISTS fuel_batches (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  trip_stop_id TEXT UNIQUE REFERENCES trip_stops(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  mode TEXT NOT NULL CHECK (mode IN ('tank','direct')),
  product TEXT NOT NULL,
  quantity_ml INTEGER NOT NULL,
  fuel_cost_halalas INTEGER,       -- NULL = غير متوفرة
  transport_cost_halalas INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS fuel_movements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL CHECK (kind IN ('opening','receipt','issue','transfer_out','transfer_in','return','adjustment','reversal','direct_allocation')),
  tank_id TEXT REFERENCES tanks(id),
  batch_id TEXT REFERENCES fuel_batches(id),
  quantity_ml INTEGER NOT NULL,    -- موجب = دخول، سالب = خروج
  cost_halalas INTEGER,            -- NULL = تكلفة غير متوفرة
  ref_type TEXT, ref_id TEXT,
  related_movement_id TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected')),
  note TEXT,
  created_by TEXT,
  approved_by TEXT,
  effective_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((tank_id IS NOT NULL) <> (batch_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_mov_tank ON fuel_movements(tank_id, status);
CREATE INDEX IF NOT EXISTS ix_mov_batch ON fuel_movements(batch_id, status);

CREATE TABLE IF NOT EXISTS stock_counts (
  id TEXT PRIMARY KEY,
  tank_id TEXT NOT NULL REFERENCES tanks(id),
  company_id TEXT NOT NULL,
  book_ml INTEGER NOT NULL,
  measured_ml INTEGER NOT NULL,
  variance_ml INTEGER NOT NULL,
  counted_by TEXT,
  counted_at TEXT NOT NULL,
  adjustment_movement_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))
);

-- ========== عمليات تزويد الأصول ==========
CREATE TABLE IF NOT EXISTS fuelings (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,     -- رقم العملية الفريد
  company_id TEXT NOT NULL REFERENCES companies(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  tag_id TEXT REFERENCES nfc_tags(id),
  verification TEXT NOT NULL CHECK (verification IN ('nfc','qr','manual')),
  source_type TEXT NOT NULL CHECK (source_type IN ('tank','batch')),
  tank_id TEXT REFERENCES tanks(id),
  batch_id TEXT REFERENCES fuel_batches(id),
  trip_id TEXT REFERENCES trips(id),
  operator_user_id TEXT NOT NULL,
  quantity_ml INTEGER NOT NULL,
  measure_source TEXT NOT NULL DEFAULT 'manual',  -- manual | pump_meter | connected
  meter_type TEXT, meter_value REAL, meter_unit TEXT,
  meter_photo_file_id TEXT,
  -- لقطة التخصيص وقت التنفيذ (تحافظ على التقارير التاريخية بعد نقل الأصل)
  project_id TEXT, site_id TEXT, cost_center_id TEXT,
  product TEXT NOT NULL,
  cost_halalas INTEGER,            -- NULL = غير متوفرة
  status TEXT NOT NULL CHECK (status IN ('draft','approved','rejected','reversed')),
  exception_flag TEXT,
  reject_reason TEXT,
  movement_id TEXT,
  corrects_fueling_id TEXT REFERENCES fuelings(id),
  client_op_id TEXT NOT NULL UNIQUE,
  captured_at TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_fuel_asset ON fuelings(asset_id, created_at);
CREATE INDEX IF NOT EXISTS ix_fuel_company ON fuelings(company_id, created_at);

-- محاولات التفويض (المقبولة والمرفوضة)
CREATE TABLE IF NOT EXISTS authorization_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  uid TEXT, tag_id TEXT, asset_id TEXT,
  operator_user_id TEXT,
  result TEXT NOT NULL,            -- authorized | rejected
  reasons_json TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ========== الاستثناءات والموافقات ==========
CREATE TABLE IF NOT EXISTS exceptions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  type TEXT NOT NULL,              -- quantity_variance | missing_proof | alt_verification | stock_variance | eligibility_change
  ref_type TEXT NOT NULL, ref_id TEXT NOT NULL,
  title TEXT NOT NULL,
  details_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected')),
  decided_by TEXT, decided_at TEXT, decision_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ========== التدقيق والإشعارات والتكرار ==========
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT, user_id TEXT, membership_role TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, data_json TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  role TEXT,
  title TEXT NOT NULL, body TEXT, link TEXT,
  source_key TEXT UNIQUE,          -- مرتبط بالعملية المعتمدة: إعادة المحاولة لا تكرر الإشعار
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
