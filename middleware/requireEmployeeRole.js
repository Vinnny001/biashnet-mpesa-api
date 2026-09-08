/*
=========================================================
REQUIRE EMPLOYEE ROLE
=========================================================

Factory middleware. Must run AFTER employeeAuth so
req.employee is populated.

Usage:

router.post(
    "/",
    requireAuth,
    employeeAuth,
    requireEmployeeRole("hr", "admin"),
    controllerFn
);

An employee with roles.admin === true is treated as
always authorized, mirroring how "admin" acts as a
super-role for HR-adjacent actions elsewhere in this
codebase.
=========================================================
*/

function requireEmployeeRole(...allowedRoles) {

    return function (req, res, next) {

        const roles = req.employee?.roles || {};

        const isAdmin = roles.admin === true;

        const hasAllowedRole = allowedRoles.some((role) => roles[role] === true);

        if (!isAdmin && !hasAllowedRole) {

            return res.status(403).json({

                success: false,

                message: `This action requires one of the following roles: ${allowedRoles.join(", ")}.`,

            });

        }

        next();

    };

}


module.exports = { requireEmployeeRole };
