using System;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Identity;
namespace ParksComputing.Engine.Identity;
public sealed class MemberSessions {
    private readonly SignInManager<IdentityUser> _signIn;
    private readonly UserManager<IdentityUser> _users;
    private readonly DurableSessions _sessions;
    private readonly AccountStatus _status;
    public MemberSessions(SignInManager<IdentityUser> signIn, UserManager<IdentityUser> users, DurableSessions sessions, AccountStatus status) {
        _signIn = signIn; _users = users; _sessions = sessions; _status = status;
    }
    public async Task<bool> EligibleAsync(IdentityUser user) => user.EmailConfirmed &&
        !await _users.IsLockedOutAsync(user) && !await _status.SuspendedAsync(user.Id);
    public async Task SignInAsync(IdentityUser user, string method, string? sessionId = null) {
        if (!await EligibleAsync(user)) { throw new InvalidOperationException("Account cannot sign in."); }
        sessionId ??= await _sessions.CreateAsync(user, method);
        await _signIn.SignInWithClaimsAsync(user, false, new[] {
            new Claim(AdminSessions.SessionClaim, sessionId), new Claim(AdminSessions.MethodClaim, method)
        });
    }
}
