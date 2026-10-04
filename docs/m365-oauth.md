# Microsoft 365 OAuth testing

This mode tests an existing Entra application using client credentials and SMTP
XOAUTH2. It does not register applications or change tenant configuration.
It targets the Microsoft 365 commercial cloud (Exchange Online).

## Inputs

- Tenant ID and Application (Client) ID: GUIDs from your application.
- Client Secret: the secret **value**, not its identifier.
- Authentication mailbox: the mailbox used in the SMTP XOAUTH2 login.
- For a mail test: sender, recipient, subject, and message. Sending as a different
  mailbox requires the corresponding Send As permission.

SMTP is fixed to `smtp.office365.com:587` with STARTTLS and certificate validation.
The token request uses `https://outlook.office365.com/.default`.

## Existing tenant prerequisites

The application needs the Exchange Online application permission
`SMTP.SendAsApp` with admin consent. Its service principal must be registered in
Exchange Online and authorized for the intended mailbox; sending needs Send As
permission. SMTP AUTH must be permitted by the mailbox and tenant policies.

Reference: [Microsoft SMTP OAuth documentation](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
and [SMTP AUTH settings](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission).

## Results

- **OAuth token**: Microsoft accepted the client credentials. This alone does not
  confirm mailbox access or sending rights.
- **Connection / Authentication**: Exchange Online accepted the SMTP connection
  and OAuth mailbox login.
- **Email delivery**: the SMTP server accepted the test message; inbox delivery
  remains the receiving server's responsibility.

Microsoft token errors expose their AADSTS code, without the raw error response.
For `EAUTH` after a successful token request, check Exchange service-principal
registration, mailbox permissions, and SMTP AUTH policy. Mail-stage failures can
also indicate missing Send As permission.

Credentials are kept in memory only and excluded from logs and exports. Access
tokens remain server-side and are discarded after each test; nothing is persisted. Use this tool locally or behind authenticated
HTTPS access. No tenant credentials are bundled with the app.
