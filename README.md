# Tabcom

> **Browser-first communication platform built for the modern web.**

Tabcom transforms the browser into a collaborative workspace by enabling users to communicate, share, and collaborate without leaving the webpage they are working on. Unlike traditional messaging applications that require constant context switching, Tabcom lives inside the browser and becomes a native communication layer for the web.

---

# Vision

The browser has become the operating system for modern work.

People spend most of their day inside Chrome or Edge, yet communication still happens in separate applications such as Slack, Teams, WhatsApp, Telegram, Discord, or email.

Tabcom aims to remove this disconnect by bringing communication directly into the browser.

Instead of switching applications...

```
Browser
        ↓
Communication
        ↓
Collaboration
        ↓
Productivity
```

The browser itself becomes the communication platform.

---

# Mission

> **Build the world's first browser-native communication operating system.**

---

# Product Philosophy

Tabcom is **not another chat application**.

Messaging is only one capability.

The long-term vision is to create a browser operating system where communication, collaboration, file sharing, browser sharing, AI assistance, and communities work together seamlessly.

---

# Core Features

## Communication

- One-to-one messaging
- Group conversations
- Voice calling
- Video calling
- Typing indicators
- Read receipts
- Presence (Online / Away / Busy)

---

## Browser Collaboration

- Share current tab
- Share URLs
- Share browser sessions
- Browser context sharing
- Collaborative browsing

---

## File Sharing

- Drag & Drop upload
- Images
- Documents
- Videos
- Clipboard sharing
- File preview

---

## Identity

- Public profiles
- Private profiles
- Invite-only discovery
- Enterprise directory support
- Custom usernames

---

## Workspace

- Inbox
- Contacts
- Communities
- Notifications
- Settings

---

## Future AI Features

- AI conversation search
- AI meeting summaries
- Smart recommendations
- Context-aware suggestions
- Browser intelligence

---

# Why Tabcom?

Today's communication tools force users to constantly switch applications.

```
Browser
↓

Slack
↓

Email
↓

Teams
↓

WhatsApp
↓

Browser
```

Tabcom removes this friction.

Everything happens inside the browser.

---

# Target Audience

- Professionals
- Product Managers
- Designers
- Developers
- Remote Teams
- Enterprise Organizations
- Students
- Knowledge Workers

Anyone who spends most of their time inside a browser.

---

# Technology Stack

## Frontend

- React 19
- TypeScript
- WXT
- Tailwind CSS v4
- Zustand
- React Hook Form
- Zod
- Framer Motion
- Lucide React

---

## Backend (Planned)

- Node.js
- NestJS
- PostgreSQL
- Redis
- Socket.IO
- Object Storage

---

## Authentication

- Google OAuth
- Microsoft OAuth
- Email Authentication
- Guest Access (Optional)

---

# Monorepo Structure

```
tabcom/

├── apps/
│   ├── extension/
│   ├── backend/
│   └── web/
│
├── packages/
│   ├── api/
│   ├── ui/
│   ├── hooks/
│   ├── utils/
│   ├── types/
│   └── config/
│
├── docs/
├── scripts/
└── README.md
```

---

# Extension Architecture

```
apps/extension/

src/

├── app/
├── components/
├── config/
├── design/
├── features/
├── hooks/
├── layouts/
├── lib/
├── providers/
├── routes/
├── services/
├── stores/
├── styles/
├── types/
└── utils/
```

---

# Current Development Status

## ✅ Completed

- Monorepo setup
- WXT extension setup
- React integration
- Tailwind CSS v4
- Global application architecture
- Design token foundation
- Application shell
- Welcome screen
- Authentication UI
- Onboarding flow foundation
- Zustand global store

---

## 🚧 In Progress

- Design System
- Reusable UI Components
- Form Components
- Profile Setup
- Workspace Shell

---

## 📋 Planned

- Authentication
- Backend API
- WebSocket Server
- Messaging
- Voice Calling
- Video Calling
- File Sharing
- Communities
- Browser Sharing
- AI Features

---

# Product Roadmap

## Phase 1

Foundation

- Extension
- Design System
- Authentication
- Onboarding

---

## Phase 2

Communication

- Messaging
- Contacts
- Presence
- Notifications

---

## Phase 3

Collaboration

- File Sharing
- Browser Sharing
- Communities
- Workspace

---

## Phase 4

Intelligence

- AI Assistant
- AI Search
- AI Summaries
- Smart Recommendations

---

# Design Principles

- Browser-first
- Minimal
- Enterprise-ready
- Accessible
- Performance-focused
- Component-driven
- Design-system-first
- Mobile-inspired interactions
- Desktop productivity

---

# Development Principles

- Feature-first architecture
- Shared components
- Strong typing
- Incremental development
- Production-quality code
- Small verifiable milestones
- Clean architecture
- Zero placeholder implementations

---

# Future Platforms

The architecture is designed to support multiple platforms.

```
                 Shared Packages
                        │
      ┌─────────────────┼─────────────────┐
      │                 │                 │
 Chrome Extension     Web App       Desktop App
      │                 │                 │
      └────────── Shared Backend ─────────┘
```

---

# Project Goals

- Browser-native communication
- Enterprise-ready architecture
- Real-time collaboration
- AI-powered productivity
- Cross-platform ecosystem

---

# Development Workflow

Every feature follows the same lifecycle.

```
Planning

↓

Design

↓

Implementation

↓

Verification

↓

Git Commit

↓

Next Milestone
```

---

# Contributing

The project follows a production-style engineering workflow.

- Small milestones
- Verified builds
- Reusable components
- Consistent architecture
- Design-system driven development

---

# License

This project is licensed under the MIT License.

---

# Author

**Ramesh Mandal**

Head of Design • Product Designer • UX Systems Designer

Building the future of browser-native communication.