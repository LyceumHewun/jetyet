# VPN Service Management

A personal-use platform for administrators to manage VPS hosts, VPN nodes, and subscriptions shared with themselves and friends. Personal use is the product's intended scope, not a temporary release limitation.

## Language

**Administrator**:
An operator with full access to the platform's management functions.
_Avoid_: Role-specific administrator.

**VPS**:
A virtual private server managed as a host for VPN deployment and host-level monitoring.
_Avoid_: Node when referring to the host itself.

**Node**:
A VPN connection endpoint managed by the platform.
_Avoid_: VPS when referring to a connection endpoint.

**Manual Installation Link**:
A temporary link issued by an **Administrator** to retrieve the installation script for a specific **Node** and its selected deployment options.

**Adaptive Performance Tuning**:
An optional deployment setting that uses the target **VPS** resources to choose network tuning and assess swap needs.

**Node Congestion Control Mode**:
The **Administrator**'s choice of Brutal or BBR for a **Node**, with Brutal selected by default.

**Subscription**:
A managed source of VPN client configurations published in supported output formats.

**Subscription Template**:
A customizable definition of a complete VPN client configuration, rendered with platform-generated user-specific node data.

**Personal Template**:
A **Subscription Template** created by a **Subscription User** for their own subscription.

**Subscription User**:
A VPN service recipient with an individual subscription link and a configurable traffic allowance.
_Avoid_: Administrator, registered account, subscription child user.

**Subscription Portal**:
A standalone page where a **Subscription User** can choose subscription links and create or preview templates.

**Portal Password Link**:
A single-use link that lets one **Subscription User** set or replace their **Subscription Portal** password.

**Traffic Allowance**:
The maximum counted traffic a VPS or Subscription User may consume in its current accounting period before the corresponding VPN access is suspended.

**Traffic Reset Policy**:
A schedule for resetting a VPS's or Subscription User's current traffic accounting period, using either a fixed monthly date or a recurring interval.

**Traffic Accounting Direction**:
The selection of outbound traffic, inbound traffic, or both counted toward a VPS's or Subscription User's usage, measured from the VPS perspective.

**Host Uptime**:
The continuous running time of a VPS since its most recent boot.

**Observed Availability**:
The proportion of platform reachability observations in which a VPS was reachable during a reporting period.

**Monitoring Coverage**:
The proportion of expected reachability observations actually performed during a reporting period.

## Relationships

- All **Administrators** have the same management access; permission separation is outside the requested scope.
- **VPS** hosts and **Nodes** each have traffic records.
- **Subscription Templates** define how **Subscriptions** are rendered.
- Friends access VPN client configurations through subscription links provided by the administrator.
- Administrators can create **Subscription Users** without requiring recipients to register.
- Administrators sign in to the management interface, and **Subscription Users** sign in to the **Subscription Portal**.
- The shared sign-in page asks for a username first and shows the same password step for everyone. A valid **Portal Password Link** opens the password-setting form.
- The shared sign-in page asks for a username first, then shows the same password step and first-time or forgotten-password guidance for everyone. Setting a password requires a valid **Portal Password Link**.
- Each **Subscription User** has an administrator-assigned sign-in username that is independent of their display name. Sign-in usernames are case-insensitive and unique across administrators and subscription users.
- Administrators issue **Portal Password Links**. **Subscription Users** use the same flow to set their first portal password or replace it.
- A **Portal Password Link** expires after 24 hours. Issuing a new link for the same **Subscription User** invalidates the previous link.
- Issuing a **Portal Password Link** preserves the current password and portal sessions. Successfully replacing the password invalidates the previous password and all existing portal sessions.
- **Portal Password Links** and subscription links are separate credentials. Subscription links grant access to VPN client configurations only.
- Each **Subscription User** has an individual subscription link and a configurable traffic allowance.
- A **Subscription User** may have an unlimited allowance: traffic is still recorded, but user-level quota exhaustion does not suspend access; VPS allowances, node authorization, and administrator suspension still apply.
- A **VPS** may have an unlimited allowance: host traffic is still recorded, but VPS-level quota exhaustion does not suspend its nodes; user allowances remain independently enforced.
- **Subscription Users** may have an expiration time and default to never expiring.
- Expiration blocks subscription retrieval and VPN access while retaining configuration and history.
- Expired **Subscription Users** can still sign in to the **Subscription Portal**.
- Extending validity removes the expiration restriction but does not override allowances, administrator suspension, or other access restrictions.
- User quota exhaustion alone does not block subscription retrieval: output retains otherwise eligible authorized nodes and exposes usage information while VPN access remains suspended.
- Administrator suspension and expiration still block subscription retrieval; a quota reset does not require adding a new subscription link.
- Traffic history retains minute-level detail for 30 days, hourly aggregates for one year, and daily aggregates indefinitely.
- Host resource metrics use the same retention windows; resource aggregates retain both mean and maximum utilization.
- Reset records and accounting-gap records are retained indefinitely; retention of traffic history does not change quota enforcement.
- Resolved alerts and detailed operation execution logs are retained for 90 days; unresolved alerts remain until resolved.
- Summaries of significant management operations are retained indefinitely.
- Each **Subscription User** uses VPN credentials isolated from other users.
- Each **Subscription User** has one platform-generated random VPN authentication token shared across that user's authorized nodes; node authorization is checked independently for each connection.
- Rotating that token changes authentication decisions across all nodes without per-node credential provisioning; existing sessions still require remote disconnection.
- Subscription-link tokens and VPN authentication tokens are independently generated credentials and can be rotated separately; VPN credentials alone do not grant subscription retrieval access.
- The management interface displays each user's observed online client-instance counts per node; these are not deduplicated physical-device counts across nodes.
- The platform imposes no device-count or simultaneous-connection limits.
- Per-user speed limiting is outside the current scope; user controls cover traffic allowances and access authorization.
- Deleting a **Subscription User** immediately revokes subscription retrieval and new-connection authentication, requests disconnection of existing sessions, and retains historical usage.
- Incomplete remote disconnections remain pending cleanup rather than being reported as complete.
- A deleted user's name may be reused, but the replacement receives a new identity and new tokens and does not inherit the deleted user's allowances or usage history.
- Changing a VPS or user's allowance preserves accumulated usage and immediately reevaluates quota exhaustion.
- Lowering an allowance below current usage applies quota suspension; raising it sufficiently or setting it to unlimited removes only the quota restriction, leaving other restrictions intact.
- Changing a reset policy preserves current usage and completed historical periods and changes only future scheduled resets; clearing current usage requires a separate manual reset.
- Always retain inbound and outbound traffic totals separately, regardless of the selected accounting direction.
- Changing the accounting direction recomputes counted usage from the current period's directional totals and immediately reevaluates quota suspension without deleting historical traffic data.
- Display traffic using explicitly labeled GiB and TiB units; allowance input also accepts explicitly labeled decimal GB to match provider quotas.
- When onboarding a **VPS**, administrators may supply current-period inbound and outbound usage independently, both defaulting to zero.
- This initial usage establishes the accounting baseline at onboarding; subsequent traffic is added without counting pre-onboarding host counters again.
- Administrators may correct a VPS's current-period inbound and outbound totals, recording the previous values, replacement values, and reason.
- Corrections preserve historical traffic samples and reset schedules and immediately reevaluate allowance exhaustion; they do not fabricate historical traffic detail.
- Historical availability and traffic charts offer 24-hour, 7-day, 30-day, and custom reporting ranges.
- Allowance summaries separately show current accounting-period usage and the next scheduled reset, rather than equating chart ranges with accounting periods.
- Repeated observations of the same ongoing fault update one alert with first-occurrence and last-observed times; recovery closes it with a recovery time, and recurrence creates a new alert.
- Marking an alert as read does not resolve its underlying fault.
- Administrators may explicitly close alerts for irrecoverable events such as accounting gaps; closure acknowledges handling of the alert rather than recovery of missing data.
- Closing an accounting-gap alert does not delete or alter its permanently retained gap record.
- A **Subscription User** shares one **Traffic Allowance** across all nodes they use.
- Exhausting the allowance suspends the user's VPN access, including access through previously downloaded configurations; disabling the subscription link alone is insufficient.
- Traffic accounting and enforcement permit delay-related overage during normal collection, approximately one collection interval plus processing and remote execution time rather than a strict bound.
- Each **VPS** and **Subscription User** can have its own **Traffic Reset Policy**, with a choice of a fixed monthly date or a recurring interval.
- Administrators can manually reset the current traffic accounting period for a **VPS** or **Subscription User**.
- Recurring resets occur every configured number of days from a specified start time.
- A manual reset clears current-period usage without changing the scheduled reset times.
- Reset schedules use the Asia/Hong_Kong timezone.
- A monthly reset date absent from a shorter month falls on that month's last day; subsequent months retain the originally configured day rather than drifting.
- After platform downtime, accounting periods follow the original scheduled boundaries; recovery time does not become a new schedule anchor.
- Available traffic data is attributed to its accounting period; traffic spanning a reset boundary that cannot be split reliably is flagged as an accounting gap rather than assigned using a guessed distribution.
- The platform collects traffic and service state every 60 seconds and probes node connections every 5 minutes, using uniform platform-wide intervals.
- Normal quota enforcement is expected to lag by approximately one collection interval plus processing and remote execution time; this is not a strict 60-second guarantee.
- Missing probes, including during platform downtime, represent unknown availability rather than VPS downtime.
- Historical **Observed Availability** is displayed together with **Monitoring Coverage** so sparse observations do not imply reliable continuous availability.
- Saving a management change records the desired configuration; it does not imply that every VPS has applied it.
- Changes awaiting an unreachable VPS are shown as pending synchronization, with per-VPS results and failure reasons.
- When connectivity returns, the platform resumes pending remote configuration and connection-revocation operations.
- User permissions and credentials are checked by the platform at connection authentication, without restarting nodes; revoking existing sessions additionally requires a successful remote disconnection operation.
- Failed or pending remote disconnections remain visibly pending rather than being reported as completed revocation.
- Authentication-backend outages reject new VPN connections without terminating existing connections; no local authentication fallback is provided.
- SSH connectivity and authentication-backend availability are distinct: losing SSH alone does not prevent platform-authorized new connections when the authentication endpoint remains reachable.
- When traffic data is stale after platform restart or monitoring-worker interruption, authentication uses the last known allowance state rather than rejecting all users solely because collection is stale.
- The platform marks stale usage and records an alert; collection recovery reevaluates allowances, and additional overage may occur before then.
- VPS names, node names, and user notes are editable display information; renaming does not reset usage, rotate credentials or subscription links, or change remote service identity.
- Node display-name changes appear in newly rendered subscriptions.
- Deleting a **Node** immediately excludes it from subscription output and requests removal of its remote VPN service and credentials.
- Node deletion completes only after remote cleanup is confirmed; an unreachable VPS leaves the node pending deletion with its management record retained.
- Pending node cleanup resumes when connectivity returns; deleting a database record alone does not constitute completed node deletion.
- Administrators may forcibly remove a VPS that cannot be cleaned up remotely after explicitly confirming that the remote host is destroyed or its remaining services will be handled independently.
- Forced removal preserves historical traffic and operation records and marks remote cleanup as unverified; it does not claim successful remote service removal.
- Normal VPS deletion first excludes all hosted nodes from subscriptions, then removes their remote services and credentials, and completes removal of the VPS management record only after cleanup succeeds.
- Removing a VPS from platform management does not destroy the cloud host; cloud-provider host destruction is outside this operation's scope.
- Administrators can disable a **VPS** without deleting it, stopping its VPN services and excluding its nodes from subscriptions while retaining SSH, monitoring, configuration, and history.
- Re-enabling a VPS restores eligible services subject to VPS allowances, user allowances, explicit node suspension, and user node authorization.
- The currently supported VPN protocol is **Hysteria 2** only; other protocols are not part of the current requirements.
- **mihomo** is the current target client; built-in subscription output targets mihomo configuration format.
- Each **VPS** and **Subscription User** independently selects its **Traffic Accounting Direction**.
- Outbound (upload) means bytes sent by the VPS; inbound (download) means bytes received by the VPS.
- **Subscription Users** default to counting both outbound and inbound traffic.
- Exhausting a **VPS** allowance suspends all **Nodes** hosted on that VPS without affecting other VPS hosts.
- Resetting an exhausted **VPS** allowance automatically removes its quota-based suspension; access remains subject to user allowances and other active restrictions.
- VPN access requires both the **VPS** and **Subscription User** to have remaining allowances.
- A **VPS** can host at most one **Node** per protocol; different ports do not permit multiple nodes using the same protocol on the same VPS.
- Since Hysteria 2 is the only currently supported protocol, each VPS currently hosts at most one managed node.
- Each **Node** has its own VPN traffic statistics, attributed to the corresponding **Subscription Users**; its public-network traffic is also included in host-level VPS accounting.
- Deployment supports either platform-operated SSH execution on a managed **VPS** or administrator execution of commands displayed by the platform.
- A **Manual Installation Link** is valid for 15 minutes and can be reused within that period to retry installation with the same deployment options.
- **Adaptive Performance Tuning** evaluates the target **VPS** during deployment in both the SSH and administrator-operated paths.
- **Adaptive Performance Tuning** can add swap on a low-memory **VPS** with sufficient disk space and no existing swap. It leaves existing swap unchanged.
- Disabling **Adaptive Performance Tuning** skips tuning in future deployments. The host keeps its applied buffer settings and swap when tuning is disabled or the **Node** is deleted.
- A **Node**'s congestion control mode determines the managed server settings and how the node is rendered in subscriptions. Brutal mode supplies default upload and download bandwidth hints of 1,000 Mbps each. BBR mode omits both hints.
- A **Node**'s subscription reflects its last verified congestion control mode.
- Administrators do not manage Brutal bandwidth in the control panel. Clients may override the subscription defaults locally.
- After administrator-operated deployment, the platform detects the deployed resources to populate their records; manual form entry alone is not the source of truth for node details.
- Both deployment paths require platform-held SSH access to the **VPS** for detection, traffic collection, and ongoing management.
- Managed VPN services must originate from the platform's standard deployment commands, whether executed by the platform or the administrator.
- Detection identifies the configuration and state of those deployments; adopting arbitrary pre-existing VPN services is outside the product scope.
- Administrators explicitly assign an allowed set of **Nodes** to each **Subscription User**, with a select-all action available.
- Subscription output, VPN credential provisioning, and actual connection authorization all follow the user's allowed node set.
- Select-all assigns only nodes that currently exist; newly created nodes require explicit assignment and are not automatically shared.
- Each **Subscription User** has one subscription entry point, one allowed node set, and one shared traffic allowance across output formats.
- Selecting a different subscription output format does not create a separate user, credential identity, node entitlement, or allowance.
- Manual or scheduled traffic resets automatically remove a **Subscription User**'s quota-based suspension.
- Traffic resets do not override administrator-imposed suspension, VPS allowance exhaustion, or node authorization restrictions.
- Traffic resets begin a new accounting period without deleting historical traffic records.
- Manual resets record the reset time and the usage accumulated before the reset.
- **VPS** accounting measures all host public-network traffic, including SSH, system updates, and other services, according to its selected accounting direction.
- **Node** and **Subscription User** accounting measures only their corresponding VPN traffic; summed node usage need not equal VPS usage.
- VPS quota exhaustion denies all new VPN authentication for that VPS and requests disconnection of existing sessions while leaving the VPN process, SSH, and monitoring running.
- VPS quota enforcement does not stop all public-network traffic; management traffic and other host services may continue consuming traffic after VPN suspension.
- VPS monitoring displays **Host Uptime** and historical **Observed Availability** separately.
- VPS monitoring also collects CPU, memory, and disk utilization every 60 seconds; process analysis and a full operations-monitoring suite are outside scope.
- Failed SSH probes mark a VPS as unreachable from the platform, not necessarily powered off.
- Node monitoring reports VPN service running state and actual connection probe results separately.
- A running process alone does not establish that a **Node** is usable; failed connection probes indicate an abnormal condition and raise an alert.
- Probe failures do not automatically trigger service restarts or redeployment.
- Nodes intentionally unavailable because of administrator suspension or exhausted VPS allowances skip connection probes and show their restriction state rather than generating connection-failure alerts.
- SSH reachability checks, host resource monitoring, and host traffic collection continue during those restrictions.
- When SSH connectivity is lost, existing VPN services continue operating rather than suspending access solely because management connectivity failed.
- After SSH connectivity returns, the platform collects accumulated traffic and applies applicable quota suspensions.
- SSH outages can cause overage that grows with outage duration; quota enforcement does not guarantee a small or fixed overage bound during outages.
- If traffic counters are lost, including after a VPS reboot during an SSH outage, the platform preserves known usage, records an accounting gap, and raises an alert.
- Missing traffic is not fabricated or estimated to fill accounting gaps; collection resumes from available counters.
- Alerts are recorded within the platform only; external notification channels are outside the requested scope.
- Administrators can independently rotate a **Subscription User**'s subscription link or VPN credentials, or rotate both in one action.
- Rotating a subscription link invalidates the old link but does not revoke VPN configurations already downloaded.
- Rotating VPN credentials invalidates the previous credentials; the user must refresh their subscription to obtain working configurations.
- **Subscription Templates** can define complete client configurations, including rules, groups, and DNS settings, with the platform supplying authorized node data and user-specific credentials.
- Templates render data and do not execute arbitrary scripts.
- Administrators can save incomplete template drafts for later editing. Drafts become available to subscribers only after successful publication.
- Publishing a template requires a user-specific preview and successful configuration validation; previews hide credentials by default.
- Invalid configuration syntax or references to nonexistent node groups block publication and leave the current valid template active.
- Subscription output is a complete, directly usable mihomo configuration rather than a fragment requiring local merging.
- The built-in default template includes DNS settings, proxy groups, and routing rules; custom templates must also produce complete configurations.
- Templates use dynamic authorized node collections and must handle empty groups according to explicit validity rules.
- Client compatibility validation belongs to template authoring. Subscription retrieval renders the published template with current node authorizations and credentials, checks the generated structure, and returns an error if it cannot produce a structurally valid configuration.
- Multiple **Subscription Templates** may target the same output format.
- Administrators assign each **Subscription User** a set of available templates and a default template.
- **Personal Templates** are available only to their creators for editing, preview, and subscription output. They are separate from administrator-assigned templates.
- A new **Personal Template** starts as an independent draft copied from the selected published template. Later changes to the source do not affect the copy.
- **Subscription Users** can save incomplete **Personal Template** drafts and publish them after a redacted preview and successful validation. A draft or failed publication leaves the last published version active.
- **Subscription Portal** previews hide real credentials, links containing credentials, and node names, addresses, and ports. Placeholder node data preserves group and routing relationships.
- Selecting a template in the **Subscription Portal** changes the current preview and template-specific link. The default subscription link continues to use the administrator-assigned default template.
- Users obtain configurations through the corresponding subscription links; selecting a template does not alter node authorization or traffic allowances.
- Temporarily unreachable or unhealthy nodes remain in subscription output; the platform displays their health state.
- Administrator-disabled nodes and nodes no longer authorized for a user are excluded from that user's subscription output.
- Retaining a node in subscription output does not bypass quota suspensions or other access restrictions.
- Administrator suspension of a **Subscription User** blocks subscription retrieval and disables all of that user's VPN credentials while preserving configuration and usage history.
- Administrator suspension also blocks sign-in and access to the **Subscription Portal**, including access through existing sessions.
- Re-enabling a user restores access only where user allowances, VPS allowances, and node authorization permit it.

## Example dialogue

> **Dev:** "Does a traffic record describe a VPS or a Node?"
> **Domain expert:** "We need both host-level and endpoint-level records; they are distinct concepts."

> **Dev:** "Can I reuse a **Manual Installation Link** to install a different **Node**?"
> **Domain expert:** "It belongs to one node and its selected options. You can reuse it to retry that installation within 15 minutes."

## Flagged ambiguities

- The Chinese term "airport" means this VPN service management platform, not an aviation facility.
- Quota enforcement has no strict overage bound; SSH outages can leave existing sessions consuming traffic until remote disconnection becomes possible, while reachable HTTP authentication can still reject new sessions.
