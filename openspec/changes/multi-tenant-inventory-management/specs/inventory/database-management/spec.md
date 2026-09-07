## Purpose

Defines how logical inventory databases are created, named, and assigned to users to enable multi-tenant inventory management.

## ADDED Requirements

### Requirement: Database Container Creation
The system SHALL allow an administrator to create named inventory databases. Each database MUST have a unique name within the system.

#### Scenario: Admin creates a new database
- **WHEN** an admin provides a valid name for a new inventory database
- **THEN** the system creates the database record and confirms success

### Requirement: Database Ownership Assignment
The system SHALL allow an administrator to assign one or more users as owners of an inventory database.

#### Scenario: Admin assigns user as database owner
- **WHEN** an admin selects a user and a database to link them
- **THEN** the user is granted ownership access to that database

### Requirement: User Database Mapping
The system SHALL maintain a mapping of each user to their active inventory database. A user can only be mapped to one active inventory database at a time.

#### Scenario: User is assigned to a database
- **WHEN** an admin assigns a user to a specific inventory database
- **THEN** all subsequent operations by that user are scoped to that database
