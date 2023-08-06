using System.ComponentModel;
using System.Linq;
using System.Net;
using System.Reflection;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

using SmartSam.Comments.Api.Models;
using SmartSam.Comments.Data;
using SmartSam.Comments.Lib;


namespace SmartSam.Comments.Api.Controllers {
    [ApiController]
    [Route("api")]
    public class Comments : Controller {
        private readonly AppDbContext _context;

        public Comments(AppDbContext context) {
            _context = context;
        }


        [HttpGet("comments")]
        public IActionResult Get() {
            var comments = _context.Comments.Include(c => c.User).ToList();
            return Ok(comments);
        }

        // GET: api/comment/5
        [HttpGet("comment/{id}")]
        public IActionResult GetComment(string id) {
            var comment = _context.Comments
                .Include(c => c.User)
                .FirstOrDefault(c => c.CommentId == id);

            if (comment == null || comment.CommentId == null) {
                return NotFound();
            }

            var commentId = comment.CommentId;

            var response = new CommentResponse {
                Comment = comment,
                Links = new List<Link> {
                    new Link {
                        Rel = "edit",
                        Method = "PUT",
                        Href = Url.Action(nameof(PutComment)),
                    },
                    new Link {
                        Rel = "update status",
                        Method = "PUT",
                        Href = Url.Action(nameof(UpdateCommentStatus), new { id = comment.CommentId }),
                    },
                    new Link {
                        Rel = "delete",
                        Method = "DELETE",
                        Href = Url.Action(nameof(DeleteComment), new { id = comment.CommentId }),
                    }
                }
            };

            return Ok(response);
        }

        // GET: api/comments/domain/page
        [HttpGet("comments/{domain}/{pageId?}")]
        public IActionResult GetComments(string domain, string? pageId, string? status) {

            IQueryable<Comment> query = _context.Comments
                .Include(c => c.User)
                .Where(c => c.Domain == domain);

            if (!string.IsNullOrEmpty(pageId)) {
                query = query.Where(c => c.PageId == pageId);
            }

            if (!string.IsNullOrEmpty(status)) {
                if (Enum.TryParse<CommentStatus>(status, true, out CommentStatus statusEnum)) {
                    query = query.Where(c => c.Status == statusEnum);
                }
                else if (int.TryParse(status, out int statusValue) && Enum.IsDefined(typeof(CommentStatus), statusValue)) {
                    query = query.Where(c => c.Status != null && (int)c.Status == statusValue);
                }
                else {
                    return Problem("status is not valid");
                }
            }

            var commentResponses = query.Select(comment => new CommentResponse {
                Comment = comment,
                Links = new List<Link> {
                    new Link {
                        Rel = "edit",
                        Method = "PUT",
                        Href = Url.Action(nameof(PutComment)),
                    },
                    new Link {
                        Rel = "update status",
                        Method = "PUT",
                        Href = Url.Action(nameof(UpdateCommentStatus), new { id = comment.CommentId }),
                    },
                    new Link {
                        Rel = "delete",
                        Method = "DELETE",
                        Href = Url.Action(nameof(DeleteComment), new { id = comment.CommentId }),
                    }
                }
            }).ToList();

            return Ok(commentResponses);
        }

        // POST: api/comment
        [HttpPost("comment")]
        public IActionResult PostComment(Comment comment) {
            if (comment == null) {
                return BadRequest();
            }

            comment.CommentId = Guid.NewGuid().ToString();
            comment.CreateDateTime = DateTime.Now;
            comment.Status = CommentStatus.AwaitingModeration;

            _context.Comments.Add(comment);
            _context.SaveChanges();
            
            return CreatedAtAction(nameof(Get), new { id = comment.CommentId }, comment);
        }

        // PUT: api/comment
        [HttpPut("comment")]
        public IActionResult PutComment(Comment comment) {
            _context.Entry(comment).State = Microsoft.EntityFrameworkCore.EntityState.Modified;
            _context.SaveChanges();

            return NoContent();
        }

        [HttpPut("comment/{id}/status")]
        public IActionResult UpdateCommentStatus(string id, [FromBody] StatusPayload request) {
            var comment = _context.Comments.Find(id);
            if (comment == null) {
                return NotFound();
            }

            if (!Enum.TryParse(request.Status, out CommentStatus newStatus)) {
                return BadRequest("Invalid status");
            }

            comment.Status = newStatus;
            _context.SaveChanges();

            return NoContent();
        }

        // DELETE: api/comment/5
        [HttpDelete("comment/{id}")]
        public IActionResult DeleteComment(string id) {
            var comment = _context.Comments.Find(id);

            if (comment == null) {
                return NotFound();
            }

            _context.Comments.Remove(comment);
            _context.SaveChanges();

            return NoContent();
        }

        [HttpGet("statuses")]
        public IActionResult GetCommentStatuses() {
            var statuses = Enum.GetValues(typeof(CommentStatus))
                .Cast<CommentStatus>()
                .Select(s => new {
                    name = s.ToString(),
                    integer_value = (int)s,
                    description = s.GetType().GetMember(s.ToString()).First().GetCustomAttribute<DescriptionAttribute>()?.Description
                })
                .ToList();

            return Ok(statuses);
        }
    }
}
