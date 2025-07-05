terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 4.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.0"
    }
  }
  
  backend "gcs" {
    bucket = "veritas-terraform-state"
    prefix = "terraform/state"
  }
}

# Variables
variable "project_id" {
  description = "Google Cloud Project ID"
  type        = string
}

variable "region" {
  description = "Google Cloud region"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "domain" {
  description = "Domain name for the application"
  type        = string
}

# Provider configuration
provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "compute.googleapis.com",
    "container.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "secretmanager.googleapis.com"
  ])
  
  service = each.value
  disable_dependent_services = true
}

# VPC Network
resource "google_compute_network" "veritas_vpc" {
  name                    = "veritas-vpc"
  auto_create_subnetworks = false
  
  depends_on = [google_project_service.required_apis]
}

# Subnets
resource "google_compute_subnetwork" "veritas_subnet" {
  name          = "veritas-subnet"
  ip_cidr_range = "10.0.0.0/24"
  network       = google_compute_network.veritas_vpc.id
  region        = var.region
  
  # Enable flow logs for security monitoring
  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling       = 0.5
    metadata           = "INCLUDE_ALL_METADATA"
  }
}

# Cloud SQL PostgreSQL Instance
resource "google_sql_database_instance" "veritas_postgres" {
  name             = "veritas-postgres-${var.environment}"
  database_version = "POSTGRES_15"
  region           = var.region
  
  settings {
    tier = "db-custom-2-7680"  # 2 vCPU, 7.5GB RAM
    
    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
      }
    }
    
    maintenance_window {
      day          = 7  # Sunday
      hour         = 3  # 3 AM
      update_track = "stable"
    }
    
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.veritas_vpc.id
    }
  }
  
  deletion_protection = var.environment == "prod"
  
  depends_on = [google_project_service.required_apis]
}

# PostgreSQL Database
resource "google_sql_database" "veritas_db" {
  name     = "veritas"
  instance = google_sql_database_instance.veritas_postgres.name
}

# PostgreSQL User
resource "google_sql_user" "veritas_user" {
  name     = "veritas"
  instance = google_sql_database_instance.veritas_postgres.name
  password = random_password.db_password.result
}

# Generate database password
resource "random_password" "db_password" {
  length  = 32
  special = true
}

# Store password in Secret Manager
resource "google_secret_manager_secret" "db_password" {
  secret_id = "veritas-db-password"
  
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}

# Redis Instance
resource "google_redis_instance" "veritas_redis" {
  name           = "veritas-redis-${var.environment}"
  tier           = "STANDARD_HA"
  memory_size_gb = 1
  region         = var.region
  
  authorized_network = google_compute_network.veritas_vpc.id
  
  redis_version = "REDIS_6_X"
  
  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 2
        minutes = 0
      }
    }
  }
  
  depends_on = [google_project_service.required_apis]
}

# GKE Cluster
resource "google_container_cluster" "veritas_gke" {
  name     = "veritas-gke-${var.environment}"
  location = var.region
  
  # Remove default node pool
  remove_default_node_pool = true
  initial_node_count       = 1
  
  network    = google_compute_network.veritas_vpc.id
  subnetwork = google_compute_subnetwork.veritas_subnet.id
  
  # Enable Workload Identity
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }
  
  # Enable network policy
  network_policy {
    enabled = true
  }
  
  # Master authorized networks
  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = "0.0.0.0/0"
      display_name = "All"
    }
  }
  
  # Private cluster configuration
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }
  
  # Release channel
  release_channel {
    channel = "REGULAR"
  }
  
  # Maintenance policy
  maintenance_policy {
    recurring_window {
      start_time = "2023-01-01T02:00:00Z"
      end_time   = "2023-01-01T06:00:00Z"
      recurrence = "FREQ=WEEKLY;BYDAY=SU"
    }
  }
  
  depends_on = [google_project_service.required_apis]
}

# GKE Node Pool
resource "google_container_node_pool" "veritas_nodes" {
  name       = "veritas-node-pool"
  location   = var.region
  cluster    = google_container_cluster.veritas_gke.name
  node_count = var.environment == "prod" ? 3 : 1
  
  node_config {
    machine_type = "e2-standard-4"
    disk_size_gb = 100
    
    # Enable workload identity
    workload_metadata_config {
      mode = "GKE_METADATA"
    }
    
    # OAuth scopes
    oauth_scopes = [
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring",
      "https://www.googleapis.com/auth/cloud-platform"
    ]
    
    # Labels
    labels = {
      environment = var.environment
      app         = "veritas"
    }
    
    # Taints for dedicated nodes
    taint {
      key    = "dedicated"
      value  = "veritas"
      effect = "NO_SCHEDULE"
    }
  }
  
  autoscaling {
    min_node_count = var.environment == "prod" ? 2 : 1
    max_node_count = var.environment == "prod" ? 10 : 3
  }
  
  management {
    auto_repair  = true
    auto_upgrade = true
  }
  
  upgrade_settings {
    max_surge       = 1
    max_unavailable = 0
  }
}

# Cloud Load Balancer
resource "google_compute_global_address" "veritas_ip" {
  name = "veritas-ip"
}

# SSL Certificate
resource "google_compute_managed_ssl_certificate" "veritas_ssl" {
  name = "veritas-ssl-cert"
  
  managed {
    domains = [var.domain]
  }
}

# Cloud Armor Security Policy
resource "google_compute_security_policy" "veritas_security_policy" {
  name = "veritas-security-policy"
  
  rule {
    action   = "deny(403)"
    priority = "1000"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Deny access by default"
  }
  
  rule {
    action   = "allow"
    priority = "2000"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["0.0.0.0/0"]
      }
    }
    description = "Allow access from anywhere"
  }
  
  # Rate limiting rule
  rule {
    action   = "rate-based-ban"
    priority = "3000"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('rate-based-threat-correlation')"
      }
    }
    rate_limit_options {
      rate_limit_threshold {
        count        = 100
        interval_sec = 60
      }
      conform_action   = "allow"
      exceed_action    = "deny(429)"
      enforce_on_key   = "IP"
    }
  }
}

# IAM Service Account for GKE
resource "google_service_account" "veritas_gke_sa" {
  account_id   = "veritas-gke-sa"
  display_name = "Veritas GKE Service Account"
}

# IAM bindings for the service account
resource "google_project_iam_member" "veritas_gke_worker" {
  project = var.project_id
  role    = "roles/container.nodeServiceAccount"
  member  = "serviceAccount:${google_service_account.veritas_gke_sa.email}"
}

resource "google_project_iam_member" "veritas_secret_access" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.veritas_gke_sa.email}"
}

# Outputs
output "gke_cluster_name" {
  value = google_container_cluster.veritas_gke.name
}

output "gke_cluster_endpoint" {
  value = google_container_cluster.veritas_gke.endpoint
}

output "postgres_instance_name" {
  value = google_sql_database_instance.veritas_postgres.name
}

output "redis_instance_name" {
  value = google_redis_instance.veritas_redis.name
}

output "load_balancer_ip" {
  value = google_compute_global_address.veritas_ip.address
} 